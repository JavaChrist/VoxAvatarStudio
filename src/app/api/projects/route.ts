import { validateProjectInput } from "@/features/projects/schema";
import { errorCode } from "@/server/firebase-admin";
import { createProject, listProjects } from "@/server/projects";
import { getSessionUser } from "@/server/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json({ projects: await listProjects(user.uid) });
  } catch (error) {
    console.error("[projects] list failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = validateProjectInput(body);
  if (!result.ok) return Response.json({ error: "invalid_input", fields: result.errors }, { status: 400 });

  try {
    const project = await createProject(user, result.value);
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    console.error("[projects] create failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
