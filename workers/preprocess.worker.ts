/// <reference lib="webworker" />

export interface WorkerInput {
  imageData: ImageData;
  width: number;
  height: number;
}

export interface WorkerOutput {
  processedImageData: ImageData;
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { imageData, width, height } = e.data;
  const data = new Uint8ClampedArray(imageData.data);

  // Luminance-weighted grayscale + adaptive thresholding
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const avg = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
    const val = avg > 180 ? 255 : avg < 80 ? 0 : avg;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = 255; // alpha
  }

  const result = new ImageData(data, width, height);
  // Transfer the buffer back to the main thread to avoid copying overhead
  self.postMessage({ processedImageData: result }, [data.buffer]);
};