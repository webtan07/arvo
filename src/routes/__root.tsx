import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { useSession } from "~/lib/useSession";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Arvo — Car Detailing Bookings" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootDocument,
});

const LOGO = "/img/logo-header.png";

function RootDocument() {
  const session = useSession();
  const isOwner = session.status === "owner";
  // Server-verified shop slug for a logged-in owner (null = no shop yet edge).
  const ownerSlug = isOwner && session.slug ? session.slug : null;
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
            <Link to="/" className="flex items-center gap-3">
              <img
                src={LOGO}
                alt="Arvo logo"
                className="h-9 w-auto object-contain"
                width={450}
                height={90}
              />
            </Link>
            <nav className="flex items-center gap-4 text-sm font-semibold text-ink-soft">
              <Link to="/" className="hover:text-brand">
                Shops
              </Link>
              {/* Owner → their shop dashboard; customer/guest → My Bookings. */}
              {isOwner ? (
                ownerSlug ? (
                  <Link to="/dashboard/$slug" params={{ slug: ownerSlug }} className="hover:text-brand">
                    My bookings
                  </Link>
                ) : (
                  <Link to="/owner/register" className="hover:text-brand">
                    My bookings
                  </Link>
                )
              ) : (
                <Link to="/account" className="hover:text-brand">
                  My bookings
                </Link>
              )}
              {/* Owner → "Dashboard" into their shop; customer/guest → "For detailers". */}
              {isOwner ? (
                ownerSlug ? (
                  <Link to="/dashboard/$slug" params={{ slug: ownerSlug }} className="hover:text-brand">
                    Dashboard
                  </Link>
                ) : (
                  <Link to="/owner/register" className="hover:text-brand">
                    Dashboard
                  </Link>
                )
              ) : (
                <Link to="/owner/login" className="hover:text-brand">
                  For detailers
                </Link>
              )}
              <span className="hidden rounded-full bg-brand px-3 py-1 text-xs font-bold text-white sm:inline">
                Car detailing · book online
              </span>
            </nav>
          </div>
        </header>

        <main className="min-h-[60vh]">
          <Outlet />
        </main>

        <footer className="border-t border-line">
          <div className="mx-auto max-w-6xl px-5 py-6 text-center text-sm text-ink-soft">
            Arvo — find a detailer, pick a slot, get it booked.
          </div>
        </footer>
        <Scripts />
      </body>
    </html>
  );
}
