import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getFirebaseAdminMessaging } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const authorization = request.headers.get("authorization");
    const expectedAuthorization =
      `Bearer ${process.env.NOTIFICATION_API_SECRET}`;

    if (
      !process.env.NOTIFICATION_API_SECRET ||
      authorization !== expectedAuthorization
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        {
          status: 401,
        }
      );
    }

    const payload = await request.json();

    const title = String(
      payload.title || "Chilli Farm Alert"
    );

    const body = String(
      payload.body || "A farm event has been detected."
    );

    const type = String(payload.type || "general");

    const url = String(
      payload.url ||
        "https://chilli-farm-dashboard-dun.vercel.app/"
    );

    const { data: subscriptions, error: subscriptionError } =
      await supabaseAdmin
        .from("push_subscriptions")
        .select("token");

    if (subscriptionError) {
      throw subscriptionError;
    }

    const tokens = [
      ...new Set(
        (subscriptions || [])
          .map((row) => row.token)
          .filter(Boolean)
      ),
    ];

    if (tokens.length === 0) {
      return NextResponse.json({
        success: false,
        successCount: 0,
        failureCount: 0,
        message: "No push notification tokens found.",
      });
    }

    const messaging = getFirebaseAdminMessaging();

    // Data-only payload gives the dashboard and service worker full control
    // over foreground/background display and prevents duplicate notifications.
    const result = await messaging.sendEachForMulticast({
      tokens,
      data: {
        title,
        body,
        type,
        url,
      },
      webpush: {
        headers: {
          Urgency: "high",
          TTL: "300",
        },
        fcmOptions: {
          link: url,
        },
      },
    });

    const failedTokens = [];

    result.responses.forEach((response, index) => {
      if (!response.success) {
        failedTokens.push({
          token: tokens[index],
          error:
            response.error?.message || "Unknown FCM error",
          code: response.error?.code || null,
        });
      }
    });

    return NextResponse.json({
      success: result.successCount > 0,
      successCount: result.successCount,
      failureCount: result.failureCount,
      failedTokens,
    });
  } catch (error) {
    console.error("Send notification error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message || "Notification sending failed.",
      },
      {
        status: 500,
      }
    );
  }
}
