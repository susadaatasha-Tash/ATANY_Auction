// frontend/src/shared/components/ProductReviews.jsx
// Extension d) — reviews on product detail (beyond spec, but requested in d)
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

export function ProductReviews({ productId }) {
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  useEffect(() => {
    apiFetch(`/products/${productId}/reviews`).then(setReviews).catch(() => setReviews([]));
  }, [productId]);

  const submit = async (e) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) return alert('Rating 1-5');
    await apiFetch(`/products/${productId}/reviews`, { method: 'POST', body: JSON.stringify({ rating, comment }) });
    setComment('');
    const updated = await apiFetch(`/products/${productId}/reviews`).catch(() => []);
    setReviews(updated);
  };

  return (
    <div className="panel">
      <div className="panel-head"><div><h2>Reviews</h2><p>What buyers say</p></div></div>
      <div style={{ padding: 16 }}>
        {reviews.length ? reviews.map((r) => (
          <div key={r.id} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>{'★'.repeat(r.rating)} {r.rating}/5</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.comment}</div>
          </div>
        )) : <div className="empty-state"><p>No reviews yet — be the first.</p></div>}
        <form onSubmit={submit} style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={rating} onChange={(e) => setRating(Number(e.target.value))} className="filter-select">
            {[5,4,3,2,1].map((n) => <option key={n} value={n}>{n} stars</option>)}
          </select>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a review…" style={{ flex: 1, minWidth: 180, height: 38, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }} maxLength={500} />
          <button className="btn btn-primary" type="submit">Post Review</button>
        </form>
      </div>
    </div>
  );
}
