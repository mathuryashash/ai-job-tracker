declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    text: string;
    version: string;
  }

  interface PDFOptions {
    max?: number;
    viewportScale?: number;
    normalizeWhitespace?: boolean;
    disableCombineTextItems?: boolean;
  }

  function pdf(dataBuffer: Buffer, options?: PDFOptions): Promise<PDFData>;

  export = pdf;
}