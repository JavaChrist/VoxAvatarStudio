import { NextResponse, type NextRequest } from "next/server";

// Contrôle rapide : sans cookie, on renvoie vers la connexion. La vérification complète se fait côté serveur.
const SESSION_COOKIE = "__session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    // Accès machine : le jeton est vérifié dans la route (getSessionUser), comme le cookie.
    if (/^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "")) return NextResponse.next();
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/connexion", request.url));
}

export const config = {
  // Restent publics : la connexion, la session, les fichiers statiques (icônes, manifest, sw.js, version.json) et les
  // webhooks, appelés sans cookie par un service qui signe ses appels (vérifiés dans la route).
  matcher: ["/((?!connexion|api/session|api/webhooks/|_next/|.*\\.[a-z0-9]+$).*)"],
};
