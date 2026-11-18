import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Gem, CreditCard, MapPin, Package, MessageCircle, Send } from 'lucide-react';
import { useOrderData } from '../purchases/useOrderData';
import { useChatbot } from '../../../shared/hooks/useChatbot';
import { renderMarkdown } from '../../../shared/lib/renderMarkdown';
import { apiFetch } from '../../../shared/lib/apiClient';

const SUGGESTED = [
  'What item did I win?',
  'What is the condition of my item?',
  'What material is it made of?',
  "What's the status of my order?",
  'When should I pay?',
  'When can I get my item?',
  'Where can I pick it up?',
  'How do I pay for my order?',
];

export default function AssistantOrderChat() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useOrderData(orderId);
  const [input, setInput] = useState('');
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  const { messages, sendMessage, quickReplies, loading: chatLoading, clearHistory } = useChatbot('customer', null, orderId);

  // Auto-scroll to bottom
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, chatLoading]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || chatLoading) return;
    sendMessage(text);
    setInput('');
  }, [input, chatLoading, sendMessage]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggested = (q) => {
    if (chatLoading) return;
    sendMessage(q);
  };

  const order = data?.order;
  const product = data?.product;
  const branch = data?.branch;
  const payment = data?.payment;

  const back = () => navigate('/customer/purchases', { replace: true });

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p role="status">Loading your winning item…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p role="alert" style={{ color: 'var(--danger, #dc2626)' }}>{error}</p>
        <button className="btn btn-outline" onClick={() => refresh()} style={{ marginTop: 12 }}>Try again</button>
        <button className="btn btn-outline" onClick={back} style={{ marginTop: 12, marginLeft: 8 }}>Back to Purchases</button>
      </div>
    );
  }

  if (!order) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p>Order not found.</p>
        <button className="btn btn-outline" onClick={back} style={{ marginTop: 12 }}>Back to Purchases</button>
      </div>
    );
  }

  const status = order.status;
  const paymentStatus = payment?.status || 'pending';
  const deadline = order.payment_deadline;
  const isExpired = order.is_expired;

  return (
    <div className="assistant-order-chat" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '100vh', background: '#F8F6F2' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#FFFFFF', borderBottom: '1px solid #E6E2DA', position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={back} aria-label="Back" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#142A4A' }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #142A4A, #C89B3C)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 16 }}>💬</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#142A4A' }}>ATANY AI Assistant</div>
          <div style={{ fontSize: 11, color: '#7B8493' }}>Ask about your winning item, order, payment, and pickup.</div>
        </div>
      </div>

      {/* Item Card */}
      <div style={{ margin: 16, padding: 16, background: '#FFFFFF', borderRadius: 12, border: '1px solid #E6E2DA', boxShadow: '0 1px 3px rgba(20,42,74,0.06)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {product?.image_url ? (
            <img src={product.image_url} alt={product.name} style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', border: '1px solid #E6E2DA' }} />
          ) : (
            <div style={{ width: 72, height: 72, borderRadius: 8, background: '#F3F1EC', display: 'grid', placeItems: 'center', border: '1px solid #E6E2DA' }}>
              <Gem size={28} color="#C89B3C" />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#142A4A' }}>{product?.name || 'Jewelry Item'}</div>
            <div style={{ fontSize: 12, color: '#7B8493', marginTop: 2 }}>
              {order.auction_code && `Auction: ${order.auction_code} · `}
              {order.transaction_code && `Order: ${order.transaction_code}`}
            </div>
            <div style={{ fontSize: 12, color: '#7B8493', marginTop: 2 }}>
              {product?.category && `${product.category} · `}
              {product?.karat_weight && `${product.karat_weight}`}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#C89B3C', marginTop: 4 }}>
              ₱{Number(order.amount).toLocaleString()}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 12, fontSize: 12 }}>
          <div>
            <div style={{ color: '#7B8493', fontWeight: 600 }}>Order Status</div>
            <div style={{ color: '#142A4A', fontWeight: 700, textTransform: 'capitalize' }}>{status}{isExpired ? ' (Expired)' : ''}</div>
          </div>
          <div>
            <div style={{ color: '#7B8493', fontWeight: 600 }}>Payment</div>
            <div style={{ color: '#142A4A', fontWeight: 700, textTransform: 'capitalize' }}>{paymentStatus}</div>
          </div>
          {deadline && (
            <div>
              <div style={{ color: '#7B8493', fontWeight: 600 }}>Payment Deadline</div>
              <div style={{ color: '#142A4A', fontWeight: 700 }}>{new Date(deadline).toLocaleDateString()}</div>
            </div>
          )}
          {branch?.name && (
            <div>
              <div style={{ color: '#7B8493', fontWeight: 600 }}>Pickup Branch</div>
              <div style={{ color: '#142A4A', fontWeight: 700 }}>{branch.name}</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => navigate(`/customer/orders/${orderId}`, { replace: false })}>
            View Order Details
          </button>
          {branch?.name && (
            <button className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => {
              const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.name + ' ' + (branch.address || ''))}`;
              window.open(url, '_blank', 'noopener,noreferrer');
            }}>
            <MapPin size={14} style={{ marginRight: 4 }} />Get Directions
          </button>
          )}
        </div>
      </div>

      {/* Chat Body */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.who === 'user' ? 'flex-end' : 'flex-start' }}>
            {m.who === 'bot' && (
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #142A4A, #C89B3C)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, marginRight: 6, flexShrink: 0, alignSelf: 'flex-end' }}>AI</div>
            )}
            <div
              style={{
                maxWidth: '75%',
                padding: '10px 14px',
                borderRadius: 12,
                background: m.who === 'user' ? '#C89B3C' : '#FFFFFF',
                color: m.who === 'user' ? '#FFFFFF' : '#142A4A',
                border: m.who === 'user' ? 'none' : '1px solid #E6E2DA',
                fontSize: 13.5,
                lineHeight: 1.5,
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
              dangerouslySetInnerHTML={m.who === 'bot' ? { __html: renderMarkdown(m.text) } : undefined}
            >
              {m.who === 'user' ? m.text : null}
            </div>
          </div>
        ))}
        {chatLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #142A4A, #C89B3C)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12 }}>AI</div>
            <div style={{ padding: '10px 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E6E2DA', fontSize: 13.5, color: '#7B8493', fontStyle: 'italic' }}>ATANY is typing…</div>
          </div>
        )}

        {/* Suggested questions (show when conversation is short) */}
        {messages.length <= 2 && !chatLoading && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => handleSuggested(q)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: '1px solid #E6E2DA',
                  background: '#FFFFFF',
                  color: '#142A4A',
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'all .15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#C89B3C'; e.currentTarget.style.color = '#C89B3C'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E6E2DA'; e.currentTarget.style.color = '#142A4A'; }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', background: '#FFFFFF', borderTop: '1px solid #E6E2DA', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your winning item, payment, or pickup…"
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid #E6E2DA',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 13.5,
            fontFamily: 'inherit',
            outline: 'none',
            minHeight: 40,
            maxHeight: 120,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || chatLoading}
          aria-label="Send"
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            border: 'none',
            background: input.trim() && !chatLoading ? '#C89B3C' : '#E6E2DA',
            color: '#FFFFFF',
            cursor: input.trim() && !chatLoading ? 'pointer' : 'default',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
