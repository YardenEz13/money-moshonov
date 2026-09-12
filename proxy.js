// Next 16 renamed middleware -> proxy. Same behaviour, new filename.
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;
  const { userId, redirectToSignIn } = await auth();
  // auth.protect() renders a 404 here instead of bouncing to sign-in; be explicit
  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });
});

export const config = {
  // skip static files and _next; run on everything else including /api
  matcher: ["/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ico|woff2?|webmanifest)).*)", "/(api|trpc)(.*)"],
};
