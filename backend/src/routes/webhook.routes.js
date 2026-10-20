import { Router } from 'express';
import express from 'express';
import { paymongoWebhook } from '../controllers/webhook.controller.js';

const router = Router();
// PayMongo webhook — public, signature verified inside controller
// Use raw body for signature: capture via express.json verify
router.post('/paymongo', express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }), paymongoWebhook);

export default router;
