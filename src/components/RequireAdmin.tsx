import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/lib/lang";
import { Loader2, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { RequireAuth } from "@/components/RequireAuth";
import { BarePageLayout } from "@/components/BarePageLayout";

/**
 * Guards a route that only an admin may see.
 *
 * Two distinct failures, deliberately shown differently:
 *  - not signed in  -> the normal sign-in block, preserving `returnTo`
 *  - signed in but not admin -> a 403, so the visitor learns the page exists
 *    but is closed to them, instead of seeing a blank screen or an error toast.
 *
 * The check is on the client purely for presentation. Every admin query also
 * enforces `requireAdmin` server-side, so bypassing this component reveals
 * nothing.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { lang } = useLang();

  return (
    <RequireAuth title={lang === "ar" ? "سجّل دخول باش تدخل" : "Connectez-vous pour continuer"}>
      <AdminOnly>{children}</AdminOnly>
    </RequireAuth>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const { t, lang } = useLang();

  if (isLoading || user === undefined) {
    return (
      <BarePageLayout>
        <div className="flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </BarePageLayout>
    );
  }

  if (user?.role !== "admin") {
    return (
      <BarePageLayout>
        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-[#eef6f1]">
                <ShieldAlert className="size-5 text-[#006233]" />
              </div>
            </div>
            <CardTitle className="text-xl">
              {lang === "ar" ? "وصول محجوز" : "Accès réservé"}
            </CardTitle>
            <CardDescription>
              {lang === "ar"
                ? "هذي الصفحة مخصصة للإدارة وحدهم."
                : "Cette page est réservée à l'administration."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            {lang === "ar"
              ? "الحساب ديالك ما عندوش صلاحية الوصول هنا (403)."
              : "Votre compte n'a pas accès à cette page (403)."}
          </CardContent>
          <CardFooter>
            <Button asChild className="w-full">
              <Link to="/">{t.navHome}</Link>
            </Button>
          </CardFooter>
        </Card>
      </BarePageLayout>
    );
  }

  return <>{children}</>;
}
