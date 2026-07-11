/** Vite turns this locally bundled worker into a same-origin static asset. */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const workerUrl: string;
  export default workerUrl;
}
