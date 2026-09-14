import { NextResponse } from "next/server";
import { deploymentManifestFromEnv, evaluateDeploymentReadiness } from "@/lib/deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const manifest = deploymentManifestFromEnv(process.env);
    const readiness = evaluateDeploymentReadiness(manifest);
    return NextResponse.json({
      product: "Symbiotic",
      generatedAt: new Date().toISOString(),
      ...readiness
    }, { status: readiness.ready ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      product: "Symbiotic",
      ready: false,
      error: error instanceof Error ? error.message : "Unable to evaluate readiness"
    }, { status: 500 });
  }
}
