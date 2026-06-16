// Downscale + re-encode meal photos before sending to the vision model, to
// minimize paid vision token cost. ~768px longest side, JPEG.

import sharp from 'sharp';

const MAX_EDGE = 768;

/**
 * Takes a raw image Buffer, returns { base64, mediaType } for an Anthropic
 * image content block.
 */
export async function downscaleToJpeg(inputBuffer) {
  const out = await sharp(inputBuffer)
    .rotate() // honor EXIF orientation before resizing
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  return { base64: out.toString('base64'), mediaType: 'image/jpeg' };
}
