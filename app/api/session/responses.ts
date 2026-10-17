import { NextResponse } from "next/server";
import { APP_SESSION_COOKIE } from "@/lib/appSession";
import {
  emptyJsonBodyFailure,
  mutationRequestFailure,
} from "@/lib/requestSecurity";

export function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function mutationFailureResponse(failure: ReturnType<typeof mutationRequestFailure>) {
  switch (failure) {
    case "invalid-origin":
      return noStoreJson({ error: "Invalid request origin" }, { status: 403 });
    case "invalid-content-type":
      return noStoreJson({ error: "Content-Type must be application/json" }, { status: 415 });
    case "body-too-large":
      return noStoreJson({ error: "Request body is too large" }, { status: 413 });
    case "invalid-json":
    case "unexpected-body":
      return noStoreJson({ error: "Expected an empty JSON object" }, { status: 400 });
    case null:
      return null;
  }
}

export async function validateSessionMutation(request: Request) {
  const headerFailure = mutationRequestFailure(request);
  if (headerFailure) return mutationFailureResponse(headerFailure);
  return mutationFailureResponse(await emptyJsonBodyFailure(request));
}

export function setSessionCookie(response: NextResponse, token: string, expires: Date) {
  response.cookies.set({
    name: APP_SESSION_COOKIE,
    value: token,
    expires,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    priority: "high",
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: APP_SESSION_COOKIE,
    value: "",
    expires: new Date(0),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    priority: "high",
  });
}
