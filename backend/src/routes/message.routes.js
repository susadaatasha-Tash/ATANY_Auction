import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendMessage, getConversations, getMessages, markRead } from '../controllers/message.controller.js';

const router = Router();

router.get('/conversations', requireAuth, getConversations);
router.get('/:partner_id', requireAuth, getMessages);
router.post('/', requireAuth, sendMessage);
router.put('/:partner_id/read', requireAuth, markRead);

export default router;
