import { createPiPdfRenderer } from "../../workers/pi-fonts";
import type { PiFontAssetsBinding } from "../../workers/pi-fonts";
import { piValidityDeadline } from "../../app/modules/proforma-invoice/domain/proforma-invoice";

export default {
  async fetch(request: Request, env: { ASSETS: PiFontAssetsBinding }) {
    try {
      if (new URL(request.url).pathname === "/deadline")
        return Response.json(piValidityDeadline(await request.json()));
      const result = await createPiPdfRenderer(env.ASSETS)(
        await request.json(),
      );
      return new Response(new Uint8Array(result.bytes), {
        headers: {
          "Content-Type": result.contentType,
          "X-PI-SHA256": result.sha256,
          "X-PI-Pages": String(result.pageCount),
          "X-PI-Fonts": String(result.fontSha256s.length),
        },
      });
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response(String(error), { status: 422 });
    }
  },
};
