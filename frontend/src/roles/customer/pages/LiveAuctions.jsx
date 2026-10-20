// frontend/src/roles/customer/pages/LiveAuctions.jsx — compatibility alias
// Canonical page is now Auctions.jsx (/customer/auctions supporting Live+Scheduled)
// This file keeps old route /customer/live working via redirect/wrapper.
import Auctions from './Auctions';
export default function LiveAuctions(props) {
  return <Auctions {...props} />;
}
