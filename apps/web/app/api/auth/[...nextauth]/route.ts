import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { forwardedRequest } from "@/lib/http/forwarded-request";

export function GET(request: NextRequest) {
  return handlers.GET(new NextRequest(forwardedRequest(request)));
}

export function POST(request: NextRequest) {
  return handlers.POST(new NextRequest(forwardedRequest(request)));
}
