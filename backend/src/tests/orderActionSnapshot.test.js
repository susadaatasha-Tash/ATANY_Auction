import { beforeEach,describe,test,expect,vi } from 'vitest';
const fixture=vi.hoisted(()=>({payments:[],ready:true,operations:[],failure:null}));
vi.mock('../db/pool.js',()=>({pool:{connect:async()=>({release(){},query:async sql=>{
 if(fixture.failure)throw fixture.failure;
 if(String(sql).includes('safety_schema_ready'))return {rows:[{safety_schema_ready:fixture.ready}]};
 if(String(sql).includes('FROM payments'))return {rows:fixture.payments};
 if(String(sql).includes('FROM payment_operations'))return {rows:fixture.operations};
 return {rows:[]};
}})}}));
import { cancellationSnapshot } from '../services/orderPaymentSafety.js';
const order=()=>({id:'order',status:'pending',payment_deadline:'2099-01-01T00:00:00Z'});
beforeEach(()=>Object.assign(fixture,{payments:[],ready:true,operations:[],failure:null}));
describe('read-only customer action availability',()=>{
 test('pending with no payment record exposes both verified actions',async()=>{
  expect(await cancellationSnapshot(order())).toMatchObject({can_request_cancellation:true,can_request_payment:true});
 });
 test('missing safety schema blocks both actions with a useful setup explanation',async()=>{
  fixture.ready=false;const result=await cancellationSnapshot(order());
  expect(result).toMatchObject({can_request_cancellation:false,can_request_payment:false,action_block_code:'PAYMENT_SCHEMA_REQUIRED'});
  expect(result.cancellation_block_reason).toMatch(/temporarily unavailable/i);
 });
 test.each(['paid','processing'])('%s on ANY attempt blocks both actions',async status=>{
  fixture.payments=[{status},{status:'pending'}];
  expect(await cancellationSnapshot(order())).toMatchObject({can_request_cancellation:false,can_request_payment:false});
 });
 test('unknown creation cannot be mistaken for no payment',async()=>{
  fixture.payments=[{provider:'paymongo',status:'failed',checkout_session_id:null,metadata:{}}];
  expect(await cancellationSnapshot(order())).toMatchObject({can_request_cancellation:false,can_request_payment:false,action_block_code:'CHECKOUT_STATE_UNKNOWN'});
 });
 test('active operation blocks safely with a retry explanation',async()=>{
  fixture.operations=[{id:'operation',state:'unknown'}];
  expect(await cancellationSnapshot(order())).toMatchObject({can_request_cancellation:false,can_request_payment:false,action_block_code:'PAYMENT_OPERATION_PENDING'});
 });
 test('database failure is closed and does not leak database text',async()=>{
  fixture.failure={code:'42P01',message:'private schema name'};
  const result=await cancellationSnapshot(order());
  expect(result.can_request_payment).toBe(false);expect(result.cancellation_block_reason).not.toContain('private schema');
 });
 test.each(['cancelled','expired','completed'])('%s order has no mutable action',async status=>{
  expect(await cancellationSnapshot({...order(),status})).toMatchObject({can_request_cancellation:false,can_request_payment:false});
 });
});
