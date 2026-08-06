import { apiError, getApiUser } from "@/lib/api";
import {
  createUserEnvironmentVariable,
  listUserEnvironmentVariables,
} from "@/lib/user-environment";

export async function GET() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const variables = await listUserEnvironmentVariables(user.id);
    return Response.json({ variables });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const variable = await createUserEnvironmentVariable(
      user.id,
      await request.json().catch(() => null),
    );
    return Response.json({ variable }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
