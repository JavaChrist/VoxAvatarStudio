import { DEFAULT_APPEARANCE, OUTFITS, POSES } from "@/features/projects/appearance";
import { getSessionUser } from "@/server/session";

/** Tenues de Chris et les poses où chacune existe (gratuit, lecture du catalogue). Sert au connecteur MCP. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({
    default: DEFAULT_APPEARANCE,
    poses: POSES,
    outfits: OUTFITS.map((outfit) => ({ id: outfit.id, name: outfit.name, poses: Object.keys(outfit.poses) })),
  });
}
