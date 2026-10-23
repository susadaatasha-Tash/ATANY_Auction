// frontend/src/shared/lib/defaultProductImage.js
// The single ATANY fallback product photo.
//
// A product can legitimately have NO uploaded photo (the seller submitted the
// listing without a file, or the upload failed). The listing must still render
// a real product image instead of an empty placeholder box.
//
// This is the same image the seller's listing form already falls back to when
// an upload fails, so a photo-less listing looks identical whether the photo
// was never chosen or the upload broke.
//
// It is a generic ATANY jewellery photo — never another listing's upload.
// (Keep in sync with backend/src/config/defaultProductImage.js.)
export const DEFAULT_PRODUCT_IMAGE_URL =
  'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=400&q=70';

/**
 * Resolve the image a card should display.
 * The real uploaded photo always wins; the ATANY default is only used when the
 * product genuinely has no usable image.
 */
export function resolveDisplayImage(listing) {
  if (!listing) return DEFAULT_PRODUCT_IMAGE_URL;
  const resolved = listing.display_image_url || listing.image_url;
  const url = typeof resolved === 'string' ? resolved.trim() : '';
  return url || DEFAULT_PRODUCT_IMAGE_URL;
}
