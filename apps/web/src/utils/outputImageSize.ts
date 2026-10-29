/** Compare decoded file dimensions, never the CSS preview box or response metadata. */
export function getOutputSizeWarning(
  requestedSize: string | undefined,
  expectedAspectRatio: string,
  width: number,
  height: number,
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || requestedSize === 'auto') return null
  const actual = `${width} × ${height}`
  const exact = requestedSize?.match(/^(\d+)x(\d+)$/)
  if (exact) {
    const expectedWidth = Number(exact[1])
    const expectedHeight = Number(exact[2])
    if (width === expectedWidth && height === expectedHeight) return null
    return `请求 ${expectedWidth} × ${expectedHeight}，实际原图 ${actual}。接口返回的图片尺寸与请求不一致。`
  }
  // Older tasks only retained the ratio, not pixel size. A non-square ratio was
  // explicit; 1:1 may also have represented auto, so do not infer a warning there.
  const ratio = expectedAspectRatio.match(/^(\d+):(\d+)$/)
  if (!requestedSize && ratio && expectedAspectRatio !== '1:1') {
    const expected = Number(ratio[1]) / Number(ratio[2])
    if (Number.isFinite(expected) && expected > 0 && Math.abs(width / height / expected - 1) > 0.01) {
      return `请求比例 ${expectedAspectRatio}，实际原图 ${actual}。接口返回的图片比例与请求不一致。`
    }
  }
  return null
}
