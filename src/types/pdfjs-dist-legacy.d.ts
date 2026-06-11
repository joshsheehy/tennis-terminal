// pdfjs-dist's exports map does not always surface types for the legacy build
// path under bundler module resolution; the call site supplies its own
// structural type for the small surface it uses.
declare module 'pdfjs-dist/legacy/build/pdf.mjs';
