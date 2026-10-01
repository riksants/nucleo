// Minimal Deno globals so the functions type-check with the project's tsc (no Deno on this machine).
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
