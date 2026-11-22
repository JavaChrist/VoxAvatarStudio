import { NextResponse, type NextRequest } from "next/server";

// Contrôle rapide : sans cookie, on renvoie vers la connexion. La vérification complète se fait côté serveur.
const SESSION_COOKIE = "__session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/connexion", request.url));
}

export const config = {
  // Restent publics : la connexion, la session et les fichiers statiques (icônes, manifest, sw.js, version.json).
  matcher: ["/((?!connexion|api/session|_next/|.*\\.[a-z0-9]+$).*)"],
};
