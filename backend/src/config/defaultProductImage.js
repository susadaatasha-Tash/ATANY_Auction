// backend/src/config/defaultProductImage.js
// The single ATANY fallback product photo.
//
// A product can legitimately have NO uploaded photo (the seller submitted the
// listing without a file, or the upload failed). In that case the listing must
// still render a real product image in My Listings / Live Auctions instead of
// an empty placeholder box.
//
// This is the SAME image the seller's listing form already falls back to when
// an upload fails, so a photo-less listing looks identical whether the photo
// was never chosen or the upload broke.
//
// It is a generic ATANY jewellery photo — never another listing's upload.
export const DEFAULT_PRODUCT_IMAGE_URL =
  'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=400&q=70';

/**
 * Resolve the image a listing card should display.
 * The real uploaded photo always wins; the ATANY default is only used when the
 * product genuinely has no usable image.
 */
export function resolveDisplayImage(product) {
  if (!product) return DEFAULT_PRODUCT_IMAGE_URL;
  // A server-resolved display image (e.g. an already-resolved storage URL)
  // wins over the raw column.
  const candidates = [product.display_image_url, product.image_url];
  for (const raw of candidates) {
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (url) return url;
  }
  return DEFAULT_PRODUCT_IMAGE_URL;
}
