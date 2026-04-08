import { NextResponse } from "next/server";

type TokaAuthenticateRequest = {
  authcode?: string;
  authCode?: string;
};

const DEFAULT_TOKA_BASE_URL = "http://talentland-toka.eastus2.cloudapp.azure.com";

export async function POST(request: Request) {
  const appId = process.env.TOKA_APP_ID;

  if (!appId) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 500,
        message: "Missing TOKA_APP_ID environment variable.",
        data: null,
      },
      { status: 500 },
    );
  }

  let body: TokaAuthenticateRequest;

  try {
    body = (await request.json()) as TokaAuthenticateRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        statusCode: 400,
        message: "Invalid JSON body.",
        data: null,
      },
      { status: 400 },
    );
  }

  const authcode = body.authcode ?? body.authCode;

  if (!authcode) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 400,
        message: "Missing authcode.",
        data: null,
      },
      { status: 400 },
    );
  }

  const baseUrl = (process.env.TOKA_API_BASE_URL ?? DEFAULT_TOKA_BASE_URL).replace(/\/$/, "");

  try {
    const tokaResponse = await fetch(`${baseUrl}/v1/user/authenticate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": appId,
      },
      body: JSON.stringify({ authcode }),
    });

    const contentType = tokaResponse.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await tokaResponse.json()
      : await tokaResponse.text();

    if (typeof payload === "string") {
      return NextResponse.json(
        {
          success: tokaResponse.ok,
          statusCode: tokaResponse.status,
          message: payload,
          data: null,
        },
        { status: tokaResponse.status },
      );
    }

    return NextResponse.json(payload, { status: tokaResponse.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error contacting Toka.";

    return NextResponse.json(
      {
        success: false,
        statusCode: 502,
        message,
        data: null,
      },
      { status: 502 },
    );
  }
}