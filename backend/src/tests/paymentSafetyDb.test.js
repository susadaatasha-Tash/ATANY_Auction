import { beforeAll, afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const state = vi.hoisted(() => ({ db: null }));
vi.mock('../db/pool.js', () => ({ pool: { connect: () => state.db.connect(), query: (...args) => state.db.query(...args) }, isDirectPg: () => true }));
vi.mock('../services/paymongoService.js', async () => ({
  ...await vi.importActual('../services/paymongoService.js'),
  getCheckoutSession: vi.fn(), expireCheckoutSession: vi.fn(), createPayMongoCheckout: vi.fn(),
}));
import { getCheckoutSession, expireCheckoutSession, createPayMongoCheckout } from '../services/paymongoService.js';
import { cancelOrderSafely, createOrderCheckoutSafely, cancellationSnapshot } from '../services/orderPaymentSafety.js';
import { receivePaymentEvent, processPaymentEvent } from '../services/paymentEvidence.js';
import { recoverPaymentOperations, reconcileCheckoutAttempts, recoverPaymentEvents } from '../services/paymentEvidence.js';
import { paymongoWebhook } from '../controllers/webhook.controller.js';
import { listPaymentReconciliations } from '../services/paymentEvidence.js';
import { recordManualPayment } from '../services/manualPayment.js';
import crypto from 'node:crypto';

// Deliberately cannot use DATABASE_URL, PGHOST, backend/.env or TCP.
const socket = process.env.ATANY_SAFETY_PG_SOCKET;
const isolated = socket === '/private/tmp/atany-safety-audit';
const suite = isolated ? describe : describe.skip;
const buyer = randomUUID(), seller = randomUUID(), foreign = randomUUID(), orderId = randomUUID();
const auctionId = randomUUID(), productId = randomUUID(), shopId = randomUUID();
const session = (id, status = 'active', payments = []) => ({ data: { id, attributes: { status, payments, reference_number: 'fixture' } } });
const request = (role = 'customer') => ({ orderId, actorId: role === 'customer' ? buyer : seller, role, reason: 'No longer needed' });
const addPayment = async (id = 'cs_old', status = 'pending') => (await state.db.query(
  `INSERT INTO payments(id,order_id,customer_id,amount,status,checkout_session_id,provider_reference_id,metadata) VALUES($1,$2,$3,1101,$4,$5,$5,'{}') RETURNING *`,
  [randomUUID(), orderId, buyer, status, id])).rows[0];
const order = async () => (await state.db.query('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0];

suite('isolated PostgreSQL payment safety', () => {
  beforeAll(async () => {
    state.db = new pg.Pool({ host: socket, port: 55438, user: 'atany_test', database: 'atany_safety_test', max: 8 });
    if(process.env.ATANY_SAFETY_USE_EXISTING_SCHEMA==='1') {
      // For runs where migration execution is prohibited: use only the already
      // provisioned disposable schema. Never silently bootstrap or repair it.
      const {rows}=await state.db.query(`SELECT to_regclass('public.payment_operations') IS NOT NULL
        AND to_regclass('public.provider_collections') IS NOT NULL
        AND to_regclass('public.payment_reconciliations') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='payment_webhook_events' AND column_name='next_attempt_at')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='payments' AND column_name='provider_checked_at') AS ready`);
      if(rows[0]?.ready!==true)throw new Error('Existing isolated safety schema is unavailable; no migration or bootstrap was performed.');
      return;
    }
    await state.db.query(`
      CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY, role text);
      CREATE TABLE IF NOT EXISTS shops(id uuid PRIMARY KEY,user_id uuid);
      CREATE TABLE IF NOT EXISTS products(id uuid PRIMARY KEY,shop_id uuid,name text);
      CREATE TABLE IF NOT EXISTS auctions(id uuid PRIMARY KEY,product_id uuid);
      CREATE TABLE IF NOT EXISTS orders(id uuid PRIMARY KEY,buyer_id uuid,auction_id uuid,amount integer,status text,
        payment_deadline timestamptz,winner_rank integer DEFAULT 1,cancellation_reason text,cancelled_at timestamptz,cancelled_by uuid);
      CREATE TABLE IF NOT EXISTS payments(id uuid PRIMARY KEY,order_id uuid,customer_id uuid,amount integer,currency text DEFAULT 'PHP',
        provider text DEFAULT 'paymongo',status text,payment_method text,checkout_session_id text UNIQUE,provider_reference_id text,
        created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),paid_at timestamptz,metadata jsonb);
      CREATE UNIQUE INDEX IF NOT EXISTS one_paid ON payments(order_id) WHERE status='paid';
      CREATE TABLE IF NOT EXISTS audit_logs(id serial,user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_code text;
      CREATE TABLE IF NOT EXISTS billing_records(id uuid PRIMARY KEY,paymongo_checkout_session_id text,amount integer);
      CREATE TABLE IF NOT EXISTS notifications(id serial,user_id uuid,type text,message text,created_at timestamptz DEFAULT now());
      ALTER TABLE payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
    `);
    await state.db.query(fs.readFileSync(new URL('../db/migrations/039_payment_safety.sql', import.meta.url), 'utf8'));
    // Evolve only this disposable database when the prepared local migration changes.
    await state.db.query("ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(); ALTER TABLE payment_reconciliations DROP CONSTRAINT IF EXISTS payment_reconciliations_state_check; ALTER TABLE payment_reconciliations ADD CONSTRAINT payment_reconciliations_state_check CHECK(state IN ('open','reviewed','resolved'))");
  });
  afterAll(async () => { await state.db?.end(); });
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('PAYMONGO_SECRET_KEY','sk_test_fixture');
    await state.db.query('TRUNCATE payment_reconciliations, provider_collections, payment_webhook_events, payment_operations, payments, notifications, audit_logs, orders, auctions, products, shops, users CASCADE');
    await state.db.query('INSERT INTO users VALUES($1,\'customer\'),($2,\'shop_owner\'),($3,\'customer\')', [buyer,seller,foreign]);
    await state.db.query('INSERT INTO shops VALUES($1,$2)', [shopId,seller]);
    await state.db.query('INSERT INTO products VALUES($1,$2,\'Fixture\')', [productId,shopId]);
    await state.db.query('INSERT INTO auctions VALUES($1,$2)', [auctionId,productId]);
    await state.db.query("INSERT INTO orders(id,buyer_id,auction_id,amount,status,payment_deadline) VALUES($1,$2,$3,1101,'pending',now()+interval '7 days')", [orderId,buyer,auctionId]);
    getCheckoutSession.mockImplementation(async id => session(id));
    expireCheckoutSession.mockImplementation(async id => session(id, 'expired'));
  });
  test('actual PostgreSQL capability query allows an unpaid fixture without writing operations',async()=>{
    expect(await cancellationSnapshot(await order())).toMatchObject({can_request_cancellation:true,can_request_payment:true});
    expect((await state.db.query('SELECT * FROM payment_operations')).rows).toHaveLength(0);
    expect(getCheckoutSession).not.toHaveBeenCalled();
  });
  test('hosted confirmation without a method hint does not invent a payment method',async()=>{
    createPayMongoCheckout.mockResolvedValue({checkoutId:'cs_hosted',checkoutUrl:'https://checkout.paymongo.com/fixture'});
    await createOrderCheckoutSafely({orderId,actorId:buyer});
    expect((await state.db.query('SELECT payment_method FROM payments WHERE order_id=$1',[orderId])).rows[0].payment_method).toBeNull();
  });
  test.each(['customer','shop_owner'])('%s cancels only after ALL old checkouts close', async role => {
    await addPayment('cs_old'); await addPayment('cs_new', 'failed');
    const result = await cancelOrderSafely(request(role));
    expect(result.status).toBe('cancelled');
    expect(expireCheckoutSession.mock.calls.map(a => a[0]).sort()).toEqual(['cs_new','cs_old']);
    expect((await order()).cancelled_by).toBe(role === 'customer' ? buyer : seller);
    expect((await state.db.query('SELECT * FROM audit_logs')).rows).toHaveLength(1);
  });
  test('processing provider payment blocks cancellation', async () => {
    await addPayment(); getCheckoutSession.mockResolvedValue(session('cs_old', 'active', [{ id: 'pay_1', attributes: { status: 'processing' } }]));
    await expect(cancelOrderSafely(request())).rejects.toMatchObject({ code: 'PAYMENT_PROCESSING' });
    expect((await order()).status).toBe('pending');
  });
  test('unknown provider state blocks cancellation and permits a safe retry', async () => {
    await addPayment(); getCheckoutSession.mockRejectedValueOnce(new Error('timeout'));
    await expect(cancelOrderSafely(request())).rejects.toBeTruthy();
    expect((await order()).status).toBe('pending');
    expect((await cancelOrderSafely(request())).status).toBe('cancelled');
  });
  test('already-expired 400 is retrieved and verified; paid 400 blocks', async () => {
    await addPayment(); expireCheckoutSession.mockRejectedValue({ providerStatus: 400 });
    getCheckoutSession.mockResolvedValueOnce(session('cs_old')).mockResolvedValueOnce(session('cs_old', 'expired'));
    expect((await cancelOrderSafely(request())).status).toBe('cancelled');
  });
  test('unknown creation outcome blocks cancellation even without a session id', async () => {
    await addPayment(null, 'failed');
    await expect(cancelOrderSafely(request())).rejects.toMatchObject({ code: 'CHECKOUT_STATE_UNKNOWN' });
  });
  test('foreign owner and paid local payment are rejected', async () => {
    await expect(cancelOrderSafely({ ...request(), actorId: foreign })).rejects.toMatchObject({ status: 403 });
    await addPayment('cs_paid', 'paid');
    await expect(cancelOrderSafely(request())).rejects.toMatchObject({ code: 'PAYMENT_NOT_CANCELLABLE' });
  });
  test('two genuinely concurrent cancellation requests commit once', async () => {
    const results = await Promise.allSettled([cancelOrderSafely(request()), cancelOrderSafely(request('shop_owner'))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await state.db.query('SELECT * FROM audit_logs')).rows).toHaveLength(1);
  });
  test('checkout creation reservation blocks cancellation until provider result is durable', async () => {
    let ready; const started = new Promise(r => { ready = r; }); let finish;
    createPayMongoCheckout.mockImplementation(() => { ready(); return new Promise(r => { finish = r; }); });
    const creation = createOrderCheckoutSafely({ orderId, actorId: buyer, paymentMethod: 'gcash', product: { name: 'Fixture' } });
    await started;
    await expect(cancelOrderSafely(request())).rejects.toMatchObject({ code: 'PAYMENT_OPERATION_PENDING' });
    finish({ checkoutId: 'cs_created', checkoutUrl: 'https://checkout.paymongo.com/fixture' });
    await creation;
    expect((await cancelOrderSafely(request())).status).toBe('cancelled');
  });
  test('cancellation reservation blocks checkout creation and expires before commit', async () => {
    await addPayment(); let ready; const started = new Promise(r => { ready = r; }); let finish;
    expireCheckoutSession.mockImplementation(() => { ready(); return new Promise(r => { finish = r; }); });
    const cancellation = cancelOrderSafely(request()); await started;
    await expect(createOrderCheckoutSafely({ orderId, actorId: buyer })).rejects.toMatchObject({ code: 'PAYMENT_OPERATION_PENDING' });
    finish(session('cs_old', 'expired')); await cancellation;
    expect(createPayMongoCheckout).not.toHaveBeenCalled();
  });
  test('failed audit write rolls back order mutation', async () => {
    await state.db.query("ALTER TABLE audit_logs ADD CONSTRAINT audit_fixture_failure CHECK(action <> 'order_cancelled')");
    try {
      await expect(cancelOrderSafely(request())).rejects.toBeTruthy();
      expect((await order()).status).toBe('pending');
    } finally { await state.db.query('ALTER TABLE audit_logs DROP CONSTRAINT audit_fixture_failure'); }
  });
  const paidEvent = (payment, eventId = 'evt_fixture', paidId = 'pay_fixture', amount = 110100) => ({ data: { id:eventId,type:'event',attributes:{ type:'checkout_session.payment.paid',livemode:false,data:{id:payment.checkout_session_id,type:'checkout_session',attributes:{reference_number:payment.id,status:'active',payments:[{id:paidId,type:'payment',attributes:{status:'paid',amount,currency:'PHP',paid_at:1700000000}}]}}}} });
  test('late payment preserves collection and opens read-only reconciliation without fulfilling', async () => {
    const p = await addPayment(); await state.db.query("UPDATE orders SET status='cancelled' WHERE id=$1",[orderId]);
    const body = paidEvent(p);
    const event = await receivePaymentEvent({ body,rawBody:JSON.stringify(body) });
    await processPaymentEvent(event.id);
    expect((await order()).status).toBe('cancelled');
    expect((await state.db.query('SELECT * FROM provider_collections')).rows[0]).toMatchObject({provider_payment_id:'pay_fixture',amount_centavos:'110100',checkout_session_id:'cs_old'});
    expect((await state.db.query('SELECT * FROM payment_reconciliations')).rows[0].reason).toBe('ORDER_NOT_PAYABLE');
    expect((await state.db.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0].metadata).toEqual({});
  });
  test('duplicate events and different events for same payment never duplicate money', async () => {
    const p=await addPayment(); const body=paidEvent(p);
    const first=await receivePaymentEvent({body,rawBody:JSON.stringify(body)});
    const second=await receivePaymentEvent({body,rawBody:JSON.stringify(body)});
    expect(first.id).toBe(second.id);
    await Promise.all([processPaymentEvent(first.id),processPaymentEvent(second.id)]);
    const third=paidEvent(p,'evt_second'); const next=await receivePaymentEvent({body:third,rawBody:JSON.stringify(third)}); await processPaymentEvent(next.id);
    expect((await state.db.query('SELECT * FROM provider_collections')).rows).toHaveLength(1);
    expect((await state.db.query("SELECT * FROM payments WHERE status='paid'")).rows).toHaveLength(1);
  });
  test('distinct external collections survive existing one-paid allocation constraint', async () => {
    const p=await addPayment();
    for (const [eventId,payId] of [['evt_1','pay_1'],['evt_2','pay_2']]) {
      const body=paidEvent(p,eventId,payId); const e=await receivePaymentEvent({body,rawBody:JSON.stringify(body)}); await processPaymentEvent(e.id);
    }
    expect((await state.db.query('SELECT * FROM provider_collections')).rows).toHaveLength(2);
    expect((await state.db.query('SELECT * FROM payment_reconciliations')).rows[0].reason).toBe('ADDITIONAL_COLLECTION');
  });
  test('amount mismatch records evidence and blocks payment allocation', async () => {
    const p=await addPayment(); const body=paidEvent(p,'evt_mismatch','pay_mismatch',1);
    const e=await receivePaymentEvent({body,rawBody:JSON.stringify(body)}); await processPaymentEvent(e.id);
    expect((await state.db.query('SELECT * FROM payment_reconciliations')).rows[0].reason).toBe('AMOUNT_OR_CURRENCY_MISMATCH');
    expect((await state.db.query('SELECT status FROM payments WHERE id=$1',[p.id])).rows[0].status).toBe('pending');
  });
  test('DB processing failure leaves durable event retryable', async () => {
    const p=await addPayment(); const body=paidEvent(p); const e=await receivePaymentEvent({body,rawBody:JSON.stringify(body)});
    await state.db.query("ALTER TABLE provider_collections ADD CONSTRAINT collection_fixture_failure CHECK(provider_payment_id <> 'pay_fixture')");
    try { await expect(processPaymentEvent(e.id)).rejects.toBeTruthy(); }
    finally { await state.db.query('ALTER TABLE provider_collections DROP CONSTRAINT collection_fixture_failure'); }
    expect((await state.db.query('SELECT state FROM payment_webhook_events WHERE id=$1',[e.id])).rows[0].state).toBe('received');
    await processPaymentEvent(e.id);
    expect((await state.db.query('SELECT state FROM payment_webhook_events WHERE id=$1',[e.id])).rows[0].state).toBe('processed');
  });
  test('settlement racing cancellation either blocks cancellation or records late money', async () => {
    const p=await addPayment(); const body=paidEvent(p); const e=await receivePaymentEvent({body,rawBody:JSON.stringify(body)});
    await Promise.allSettled([processPaymentEvent(e.id), cancelOrderSafely(request())]);
    const o=await order();
    expect((await state.db.query('SELECT * FROM provider_collections')).rows).toHaveLength(1);
    if(o.status==='cancelled') expect((await state.db.query('SELECT * FROM payment_reconciliations')).rows).toHaveLength(1);
    else expect((await state.db.query("SELECT * FROM payments WHERE status='paid'")).rows).toHaveLength(1);
  });
  test('paid expiration rejection does not cancel', async()=>{
    await addPayment(); expireCheckoutSession.mockRejectedValue({providerStatus:400});
    getCheckoutSession.mockResolvedValueOnce(session('cs_old')).mockResolvedValueOnce(session('cs_old','active',[{id:'pay_paid',attributes:{status:'paid'}}]));
    await expect(cancelOrderSafely(request())).rejects.toMatchObject({code:'PAYMENT_PAID'});
    expect((await order()).status).toBe('pending');
  });
  test('provider creation timeout is durable and prevents duplicate creation or cancellation',async()=>{
    createPayMongoCheckout.mockRejectedValue(new Error('timeout after remote creation'));
    await expect(createOrderCheckoutSafely({orderId,actorId:buyer})).rejects.toMatchObject({code:'CHECKOUT_STATE_UNKNOWN'});
    await expect(cancelOrderSafely(request())).rejects.toMatchObject({code:'PAYMENT_OPERATION_PENDING'});
    await expect(createOrderCheckoutSafely({orderId,actorId:buyer})).rejects.toMatchObject({code:'PAYMENT_OPERATION_PENDING'});
    expect(createPayMongoCheckout).toHaveBeenCalledTimes(1);
    expect((await state.db.query('SELECT state FROM payment_operations')).rows[0].state).toBe('unknown');
  });
  test('reassigned buyer payment is retained for review, never allocated to new buyer',async()=>{
    const p=await addPayment();await state.db.query('UPDATE orders SET buyer_id=$2 WHERE id=$1',[orderId,foreign]);
    const body=paidEvent(p);const e=await receivePaymentEvent({body,rawBody:JSON.stringify(body)});await processPaymentEvent(e.id);
    expect((await state.db.query('SELECT * FROM payment_reconciliations')).rows[0].reason).toBe('BUYER_MISMATCH');
    expect((await state.db.query("SELECT * FROM payments WHERE status='paid'")).rows).toHaveLength(0);
  });
  test('actual signed webhook stores receipt and read-only Admin projection exposes late collection',async()=>{
    const p=await addPayment();await state.db.query("UPDATE orders SET status='cancelled' WHERE id=$1",[orderId]);
    const body=paidEvent(p),rawBody=JSON.stringify(body),t=String(Math.floor(Date.now()/1000));
    vi.stubEnv('PAYMONGO_WEBHOOK_SECRET','fixture');
    const te=crypto.createHmac('sha256','fixture').update(`${t}.${rawBody}`).digest('hex');
    const res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};
    await paymongoWebhook({body,rawBody,headers:{'paymongo-signature':`t=${t},te=${te},li=`}},res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({received:true}));
    const admin={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};
    await listPaymentReconciliations({},admin);
    expect(admin.json.mock.calls[0][0][0]).toMatchObject({order_status:'cancelled',provider_payment_id:'pay_fixture'});
    vi.unstubAllEnvs();
  });
  test('manual confirmation cannot repurpose an active gateway attempt',async()=>{
    const p=await addPayment();
    expect(await recordManualPayment({orderId,actorId:buyer,expectedBuyerId:buyer})).toMatchObject({ok:false,reason:'EXTERNAL_CHECKOUT_REQUIRES_CLOSURE'});
    expect((await state.db.query('SELECT * FROM payments WHERE id=$1',[p.id])).rows[0]).toMatchObject({status:'pending',checkout_session_id:'cs_old',provider:'paymongo'});
  });
  test('manual confirmation rejects legacy unknown gateway creation without identifier',async()=>{
    await addPayment(null,'failed');
    expect(await recordManualPayment({orderId,actorId:buyer})).toMatchObject({ok:false,reason:'EXTERNAL_CHECKOUT_REQUIRES_CLOSURE'});
  });
  test('signed test-mode money is reviewed rather than allocated in live mode',async()=>{
    const p=await addPayment();const body=paidEvent(p);const e=await receivePaymentEvent({body,rawBody:JSON.stringify(body)});
    vi.stubEnv('PAYMONGO_SECRET_KEY','sk_live_fixture');await processPaymentEvent(e.id);
    expect((await state.db.query("SELECT * FROM payments WHERE status='paid'")).rows).toHaveLength(0);
    expect((await state.db.query('SELECT * FROM payment_reconciliations')).rows[0].reason).toBe('PROVIDER_MODE_MISMATCH');
  });
  test('early unmatched payment is correlated and allocated by the later checkout event',async()=>{
    const p=await addPayment();
    const body={data:{id:'evt_early',attributes:{type:'payment.paid',livemode:false,data:{id:'pay_fixture',type:'payment',attributes:{status:'paid',amount:110100,currency:'PHP'}}}}};
    const first=await receivePaymentEvent({body,rawBody:JSON.stringify(body)});await processPaymentEvent(first.id);
    const later=paidEvent(p);const second=await receivePaymentEvent({body:later,rawBody:JSON.stringify(later)});await processPaymentEvent(second.id);
    expect((await state.db.query('SELECT * FROM provider_collections')).rows).toHaveLength(1);
    expect((await state.db.query("SELECT * FROM payments WHERE status='paid'")).rows).toHaveLength(1);
  });
  test('active checkout with mismatched amount is never reused',async()=>{
    const p=await addPayment();getCheckoutSession.mockResolvedValue({data:{id:'cs_old',attributes:{status:'active',livemode:false,reference_number:p.id,checkout_url:'https://checkout.paymongo.com/old',line_items:[{amount:1,currency:'PHP',quantity:1}]}}});
    await expect(createOrderCheckoutSafely({orderId,actorId:buyer})).rejects.toMatchObject({code:'CHECKOUT_EVIDENCE_MISMATCH'});
    expect(createPayMongoCheckout).not.toHaveBeenCalled();
  });
  test('paid webhook recovers an unknown creation using its persisted attempt reference',async()=>{
    createPayMongoCheckout.mockRejectedValue(new Error('timeout'));await expect(createOrderCheckoutSafely({orderId,actorId:buyer})).rejects.toBeTruthy();
    const p=(await state.db.query('SELECT * FROM payments')).rows[0];
    const body=paidEvent({...p,checkout_session_id:'cs_recovered'});const e=await receivePaymentEvent({body,rawBody:JSON.stringify(body)});await processPaymentEvent(e.id);
    expect((await state.db.query('SELECT state FROM payment_operations')).rows[0].state).toBe('completed');
    expect((await state.db.query('SELECT checkout_session_id FROM payments')).rows[0].checkout_session_id).toBe('cs_recovered');
  });
  test('HTTP 408 is an uncertain creation outcome and remains blocked',async()=>{
    createPayMongoCheckout.mockRejectedValue({providerStatus:408});
    await expect(createOrderCheckoutSafely({orderId,actorId:buyer})).rejects.toMatchObject({code:'CHECKOUT_STATE_UNKNOWN'});
    expect((await state.db.query('SELECT state FROM payment_operations')).rows[0].state).toBe('unknown');
  });
  test('stale cancellation is retryable; stale creation remains unknown and visible',async()=>{
    const op=randomUUID();
    await state.db.query("INSERT INTO payment_operations(id,order_id,actor_id,kind,state,context,updated_at) VALUES($1,$2,$3,'cancel','running','{}',now()-interval '10 minutes')",[op,orderId,buyer]);
    await recoverPaymentOperations();
    expect((await state.db.query('SELECT state FROM payment_operations WHERE id=$1',[op])).rows[0].state).toBe('failed');
    await state.db.query("UPDATE payment_operations SET kind='checkout',state='running',context=$2,updated_at=now()-interval '10 minutes' WHERE id=$1",[op,JSON.stringify({attempt_id:randomUUID()})]);
    await recoverPaymentOperations();
    expect((await state.db.query('SELECT state FROM payment_operations WHERE id=$1',[op])).rows[0].state).toBe('unknown');
    expect((await state.db.query('SELECT * FROM payment_reconciliations')).rows[0].reason).toBe('CHECKOUT_OPERATION_INTERRUPTED');
  });
  test('lookup failures rotate through all attempts rather than starving later ones',async()=>{
    for(let i=0;i<21;i++) await addPayment(`cs_${i}`);
    getCheckoutSession.mockRejectedValue(new Error('404'));
    await reconcileCheckoutAttempts(); await reconcileCheckoutAttempts();
    expect(new Set(getCheckoutSession.mock.calls.map(a=>a[0])).size).toBe(21);
  });
  test('verified expired checkout permits manual recording without reusing gateway identity',async()=>{
    const p=await addPayment();getCheckoutSession.mockResolvedValue(session('cs_old','expired'));
    await reconcileCheckoutAttempts();
    const result=await recordManualPayment({orderId,actorId:buyer});
    expect(result,result.error).toMatchObject({ok:true,created:true});
    expect(result.payment.provider).toBe('counter');
    expect(result.payment.checkout_session_id).toBeNull();
    expect((await state.db.query('SELECT status FROM payments WHERE id=$1',[p.id])).rows[0].status).toBe('pending');
  });
  test('stale reuse is rejected if winner assignment changes during verification',async()=>{
    const p=await addPayment();
    getCheckoutSession.mockImplementation(async()=>{
      await state.db.query('UPDATE orders SET buyer_id=$2,winner_rank=2 WHERE id=$1',[orderId,foreign]);
      return {data:{id:'cs_old',attributes:{status:'active',reference_number:p.id,livemode:false,line_items:[{amount:110100,currency:'PHP',quantity:1}],checkout_url:'https://checkout.paymongo.com/fixture'}}};
    });
    await expect(createOrderCheckoutSafely({orderId,actorId:buyer})).rejects.toMatchObject({code:'ORDER_CHANGED'});
  });
  test('a recovered operation token cannot create checkout while a new cancellation is reserved',async()=>{
    await addPayment();
    getCheckoutSession.mockImplementation(async()=>{
      await state.db.query("UPDATE payment_operations SET state='failed' WHERE order_id=$1",[orderId]);
      await state.db.query("INSERT INTO payment_operations(id,order_id,actor_id,kind,state) VALUES($1,$2,$3,'cancel','running')",[randomUUID(),orderId,buyer]);
      return session('cs_old','expired');
    });
    createPayMongoCheckout.mockResolvedValue({checkoutId:'cs_should_not_exist',checkoutUrl:'https://checkout.paymongo.com/no'});
    await expect(createOrderCheckoutSafely({orderId,actorId:buyer})).rejects.toMatchObject({code:'PAYMENT_OPERATION_PENDING'});
    expect(createPayMongoCheckout).not.toHaveBeenCalled();
  });
  test('final cancellation recheck refuses a newly appeared unidentified attempt',async()=>{
    await addPayment();expireCheckoutSession.mockImplementation(async()=>{await addPayment(null);return session('cs_old','expired');});
    await expect(cancelOrderSafely(request())).rejects.toMatchObject({code:'CHECKOUT_STATE_UNKNOWN'});
    expect((await order()).status).toBe('pending');
  });
});
