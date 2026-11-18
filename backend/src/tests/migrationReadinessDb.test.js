// Opt-in only: the rehearsal script owns and stops this exact socket-only cluster.
// No DATABASE_URL, application credentials or schema repair is used here.
import { beforeAll, afterAll, beforeEach, describe, test, expect, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const state = vi.hoisted(() => ({ db: null }));
vi.mock('../db/pool.js', () => ({ pool: { connect: () => state.db.connect(), query: (...args) => state.db.query(...args) } }));
vi.mock('../services/paymongoService.js', async () => ({ ...await vi.importActual('../services/paymongoService.js'),
  createPayMongoCheckout: vi.fn(), getCheckoutSession: vi.fn(), expireCheckoutSession: vi.fn() }));
import { createPayMongoCheckout, getCheckoutSession, expireCheckoutSession } from '../services/paymongoService.js';
import { createOrderCheckoutSafely, cancelOrderSafely, cancellationSnapshot } from '../services/orderPaymentSafety.js';
import { receivePaymentEvent, processPaymentEvent, listPaymentReconciliations } from '../services/paymentEvidence.js';

const suite = process.env.ATANY_MIGRATION_REHEARSAL === '1' ? describe : describe.skip;
const buyer = randomUUID(), foreign = randomUUID(), seller = randomUUID(), shop = randomUUID();
const product = randomUUID(), auction = randomUUID(), orderId = randomUUID();
let owner;
const order = async () => (await owner.query('SELECT * FROM orders WHERE id=$1',[orderId])).rows[0];
const checkout = () => createOrderCheckoutSafely({ orderId, actorId: buyer });
const cancel = (role='customer') => cancelOrderSafely({ orderId, actorId: role==='customer'?buyer:seller, role, reason:'Synthetic rehearsal' });
const session = (status='active', payments=[]) => ({ data:{ id:'cs_fixture', attributes:{ status,payments } } });
const addPayment = async (status='pending', id='cs_fixture') => (await owner.query(`INSERT INTO payments(order_id,customer_id,amount,status,checkout_session_id,provider_reference_id,metadata)
  VALUES($1,$2,1101,$3,$4,$4,'{}') RETURNING *`, [orderId,buyer,status,id])).rows[0];

suite('037 → 038 → 039 on enum/constraint/RLS source-derived local schema', () => {
  beforeAll(async () => {
    const connection = { host:'/private/tmp/atany-migration-rehearsal',port:55440,user:'atany_migrator',database:'atany_migration_test' };
    owner = new pg.Pool(connection);
    state.db = new pg.Pool({ ...connection, max:8, options:'-c role=atany_runtime' });
    expect((await owner.query("SELECT current_setting('listen_addresses') AS listens")).rows[0].listens).toBe('');
    const role = (await state.db.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    expect(role).toEqual({current_user:'atany_runtime',rolsuper:false,rolbypassrls:false});
  });
  afterAll(async () => { await state.db?.end(); await owner?.end(); });
  beforeEach(async () => {
    vi.resetAllMocks(); vi.stubEnv('PAYMONGO_SECRET_KEY','sk_test_fixture');
    // Only synthetic rows on the hard-coded disposable target are truncated.
    await owner.query('TRUNCATE payment_reconciliations,provider_collections,payment_webhook_events,payment_operations,payments,notifications,audit_logs,orders,bids,auctions,products,shops CASCADE');
    await owner.query(`INSERT INTO users(id,name,email,password_hash,role) VALUES
      ($1::uuid,'Fixture buyer',$1::uuid::text||'@fixture.invalid','none','customer'),
      ($2::uuid,'Fixture foreign',$2::uuid::text||'@fixture.invalid','none','customer'),
      ($3::uuid,'Fixture seller',$3::uuid::text||'@fixture.invalid','none','shop_owner') ON CONFLICT(id) DO NOTHING`, [buyer,foreign,seller]);
    await owner.query("INSERT INTO shops(id,user_id,shop_name) VALUES($1,$2,'Fixture shop')",[shop,seller]);
    await owner.query("INSERT INTO products(id,shop_id,name,category,price) VALUES($1,$2,'Fixture jewel','Necklaces',1101)",[product,shop]);
    await owner.query("INSERT INTO auctions(id,product_id,start_price,start_time,end_time) VALUES($1,$2,1101,now()-interval '1 hour',now())",[auction,product]);
    await owner.query("INSERT INTO orders(id,auction_id,buyer_id,amount,payment_deadline) VALUES($1,$2,$3,1101,now()+interval '7 days')",[orderId,auction,buyer]);
    getCheckoutSession.mockResolvedValue(session());
    expireCheckoutSession.mockResolvedValue(session('expired'));
    createPayMongoCheckout.mockResolvedValue({checkoutId:'cs_fixture',checkoutUrl:'https://checkout.paymongo.com/fixture'});
  });
  test('complete schema returns internal safety_schema_ready=true and enables both advisory capabilities', async () => {
    // Capture the actual query result, without modifying the service response contract.
    const c = await state.db.connect();
    const original = c.query.bind(c); let ready;
    c.query = async (...args) => { const result=await original(...args); if(String(args[0]).includes('AS safety_schema_ready')) ready=result.rows[0].safety_schema_ready; return result; };
    const connect = vi.spyOn(state.db,'connect').mockResolvedValue(c);
    try { expect(await cancellationSnapshot(await order())).toMatchObject({can_request_payment:true,can_request_cancellation:true,action_block_code:null}); expect(ready).toBe(true); }
    finally { c.query=original; connect.mockRestore(); }
    expect((await owner.query('SELECT * FROM payment_operations')).rows).toHaveLength(0);
  });
  test('eligible unpaid order creates one durable checkout with actual enum types', async () => {
    const result=await checkout(); expect(result.checkout_url).toContain('/fixture');
    expect((await owner.query('SELECT status,checkout_session_id FROM payments')).rows).toEqual([{status:'pending',checkout_session_id:'cs_fixture'}]);
    expect(createPayMongoCheckout).toHaveBeenCalledTimes(1);
  });
  test.each(['paid','processing'])('%s payment rejects checkout and cancellation', async status => {
    await addPayment(status);
    await expect(checkout()).rejects.toMatchObject({code:'PAYMENT_NOT_CANCELLABLE'});
    await expect(cancel()).rejects.toMatchObject({code:'PAYMENT_NOT_CANCELLABLE'});
    expect(createPayMongoCheckout).not.toHaveBeenCalled(); expect(expireCheckoutSession).not.toHaveBeenCalled();
  });
  test.each(['customer','shop_owner'])('%s closes active and historical checkouts before cancellation',async role=>{
    await addPayment(); await addPayment('failed','cs_older');
    getCheckoutSession.mockImplementation(async id=>({data:{id,attributes:{status:'active',payments:[]}}}));
    expireCheckoutSession.mockImplementation(async id=>({data:{id,attributes:{status:'expired',payments:[]}}}));
    expect((await cancel(role)).status).toBe('cancelled');
    expect(expireCheckoutSession.mock.calls.map(([id])=>id).sort()).toEqual(['cs_fixture','cs_older']);
    expect((await order()).cancelled_by).toBe(role==='customer'?buyer:seller);
  });
  test('duplicate concurrent payment requests create a single provider checkout',async()=>{
    let entered, finish;
    const enteredPromise=new Promise(r=>{entered=r;});
    createPayMongoCheckout.mockImplementation(()=>{entered(); return new Promise(r=>{finish=r;});});
    const first=checkout(); await enteredPromise;
    try { await expect(checkout()).rejects.toMatchObject({code:'PAYMENT_OPERATION_PENDING'}); }
    finally { finish({checkoutId:'cs_fixture',checkoutUrl:'https://checkout.paymongo.com/fixture'}); await first; }
    expect(createPayMongoCheckout).toHaveBeenCalledTimes(1);
    expect((await owner.query('SELECT * FROM payments')).rows).toHaveLength(1);
  });
  test('checkout reservation blocks racing cancellation',async()=>{
    let entered, finish; const enteredPromise=new Promise(r=>{entered=r;});
    createPayMongoCheckout.mockImplementation(()=>{entered(); return new Promise(r=>{finish=r;});});
    const first=checkout(); await enteredPromise;
    try { await expect(cancel()).rejects.toMatchObject({code:'PAYMENT_OPERATION_PENDING'}); }
    finally { finish({checkoutId:'cs_fixture',checkoutUrl:'https://checkout.paymongo.com/fixture'}); await first; }
    expect((await order()).status).toBe('pending');
  });
  test('cancellation reservation blocks racing checkout',async()=>{
    await addPayment(); let entered, finish; const enteredPromise=new Promise(r=>{entered=r;});
    expireCheckoutSession.mockImplementation(()=>{entered(); return new Promise(r=>{finish=r;});});
    const first=cancel(); await enteredPromise;
    try { await expect(checkout()).rejects.toMatchObject({code:'PAYMENT_OPERATION_PENDING'}); }
    finally { finish(session('expired')); await first; }
    expect(createPayMongoCheckout).not.toHaveBeenCalled(); expect((await order()).status).toBe('cancelled');
  });
  test('unpaid order cancels without provider call or invented payment',async()=>{
    expect((await cancel()).status).toBe('cancelled');
    expect((await owner.query('SELECT * FROM payments')).rows).toHaveLength(0);
    expect(getCheckoutSession).not.toHaveBeenCalled();
  });
  test('unauthorized customer cannot pay or cancel',async()=>{
    await expect(createOrderCheckoutSafely({orderId,actorId:foreign})).rejects.toMatchObject({code:'ORDER_NOT_FOUND',status:403});
    await expect(cancelOrderSafely({orderId,actorId:foreign,role:'customer',reason:'Fixture'})).rejects.toMatchObject({code:'ORDER_NOT_FOUND',status:403});
    expect((await owner.query('SELECT * FROM payment_operations')).rows).toHaveLength(0);
  });
  test('missing configuration sends no HTTP and fails closed with durable evidence',async()=>{
    vi.stubEnv('PAYMONGO_SECRET_KEY','');
    const actual = await vi.importActual('../services/paymongoService.js');
    createPayMongoCheckout.mockImplementation(actual.createPayMongoCheckout);
    const network = vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('HTTP forbidden in local rehearsal'));
    try {
      await expect(checkout()).rejects.toMatchObject({code:'CHECKOUT_STATE_UNKNOWN',status:503});
      expect(network).not.toHaveBeenCalled(); expect((await order()).status).toBe('pending');
      expect((await owner.query('SELECT reason FROM payment_reconciliations')).rows).toEqual([{reason:'CHECKOUT_CREATION_UNKNOWN'}]);
      await expect(cancel()).rejects.toMatchObject({code:'PAYMENT_OPERATION_PENDING'});
    } finally { network.mockRestore(); }
  });
  test('audit failure rolls back cancellation and releases its operation for retry',async()=>{
    await owner.query("ALTER TABLE audit_logs ADD CONSTRAINT local_audit_failure CHECK(action<>'order_cancelled')");
    try { await expect(cancel()).rejects.toBeTruthy(); expect((await order()).status).toBe('pending'); }
    finally { await owner.query('ALTER TABLE audit_logs DROP CONSTRAINT local_audit_failure'); }
    expect((await cancel()).status).toBe('cancelled');
  });
  test('unique active-operation index rejects a second reservation in PostgreSQL',async()=>{
    await owner.query("INSERT INTO payment_operations(id,order_id,actor_id,kind,state) VALUES(gen_random_uuid(),$1,$2,'checkout','running')",[orderId,buyer]);
    await expect(owner.query("INSERT INTO payment_operations(id,order_id,actor_id,kind,state) VALUES(gen_random_uuid(),$1,$2,'cancel','unknown')",[orderId,buyer])).rejects.toMatchObject({code:'23505'});
  });
  // Keep this last so the rehearsal's post-migration backup includes non-empty
  // webhook, collection and reconciliation evidence, not just empty table DDL.
  test('late money is preserved and exposed to Admin reconciliation without fulfilment',async()=>{
    const p=await addPayment(); await cancel();
    const body={data:{id:'evt_fixture',type:'event',attributes:{type:'checkout_session.payment.paid',livemode:false,data:{id:'cs_fixture',type:'checkout_session',attributes:{reference_number:p.id,status:'active',payments:[{id:'pay_fixture',type:'payment',attributes:{status:'paid',amount:110100,currency:'PHP',paid_at:1700000000}}]}}}}};
    const event=await receivePaymentEvent({body,rawBody:JSON.stringify(body)}); await processPaymentEvent(event.id);
    expect((await order()).status).toBe('cancelled');
    expect((await owner.query('SELECT provider_payment_id,amount_centavos FROM provider_collections')).rows).toEqual([{provider_payment_id:'pay_fixture',amount_centavos:'110100'}]);
    const res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};
    await listPaymentReconciliations({},res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toHaveLength(1);
    expect(res.json.mock.calls[0][0][0]).toMatchObject({order_status:'cancelled',provider_payment_id:'pay_fixture'});
  });
});
