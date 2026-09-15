import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

test('Modal traps focus and closes on Escape', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Modal open title="Hello" onClose={onClose}><button>inside</button></Modal>);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalled();
});
