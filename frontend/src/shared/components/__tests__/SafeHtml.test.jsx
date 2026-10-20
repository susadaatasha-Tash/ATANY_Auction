import { render } from '@testing-library/react';
import { SafeHtml, ActivityText } from '../SafeHtml';

test('SafeHtml escapes XSS, allows <b>', () => {
  const { container } = render(<SafeHtml html={'<img onerror=alert(1)> hi <b>ok</b>'} />);
  expect(container.innerHTML).not.toContain('<img');
  expect(container.innerHTML).toContain('<b>ok</b>');
});

test('ActivityText splits <b> without innerHTML', () => {
  const { getByText } = render(<ActivityText text={'John placed <b>₱100</b> bid'} />);
  expect(getByText('₱100').tagName).toBe('B');
});
