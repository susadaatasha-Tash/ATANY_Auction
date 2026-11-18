import { verifyWebhookSignature } from '../services/paymongoService.js';
import { receivePaymentEvent, processPaymentEvent } from '../services/paymentEvidence.js';

export async function paymongoWebhook(req,res) {
  if (!req.rawBody || !verifyWebhookSignature(req.rawBody,req.headers['paymongo-signature'] || req.headers['x-paymongo-signature'])) {
    return res.status(403).json({message:'Invalid webhook signature'});
  }
  try {
    const event=await receivePaymentEvent({body:req.body,rawBody:req.rawBody});
    try { await processPaymentEvent(event.id); }
    catch(error) { console.error('[payment-event] processing deferred',event.id,error.code || 'PROCESSING_FAILED'); }
    return res.json({received:true,event_id:event.id});
  } catch(error) {
    return res.status(error.status || 503).json({message:'Unable to store provider event',code:error.code || 'EVENT_STORAGE_UNAVAILABLE'});
  }
}
