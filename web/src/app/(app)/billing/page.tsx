import { CreditCard, Check, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "For personal use",
    features: [
      "1 Gmail account",
      "50 scans / month",
      "CSV export",
      "30-day history",
    ],
    current: true,
  },
  {
    name: "Pro",
    price: "$19",
    period: "/ month",
    description: "For freelancers & small teams",
    features: [
      "3 Gmail accounts",
      "Unlimited scans",
      "CSV + Word export",
      "Unlimited history",
      "Priority support",
    ],
    highlighted: true,
  },
  {
    name: "Business",
    price: "$49",
    period: "/ month",
    description: "For growing companies",
    features: [
      "Unlimited Gmail accounts",
      "Unlimited scans",
      "All export formats",
      "Team collaboration",
      "API access",
      "Custom integrations",
    ],
  },
];

export default function BillingPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Billing"
        description="Manage your subscription and billing"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 stagger-children">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              "relative rounded-2xl border bg-card/80 backdrop-blur-sm p-7 flex flex-col transition-all duration-300",
              plan.highlighted
                ? "border-primary/30 shadow-xl shadow-primary/10 hover:shadow-2xl hover:shadow-primary/15 hover:-translate-y-1"
                : "border-border/60 shadow-lg shadow-black/5 hover:border-border hover:shadow-xl hover:-translate-y-0.5"
            )}
          >
            {plan.highlighted && (
              <div className="absolute -top-px left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent" />
            )}

            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">{plan.name}</h3>
              {plan.current && (
                <Badge variant="outline">Current</Badge>
              )}
              {plan.highlighted && (
                <Badge variant="default">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Popular
                </Badge>
              )}
            </div>

            <div className="mb-1.5">
              <span className="text-4xl font-bold tracking-tight">
                {plan.price}
              </span>
              <span className="text-sm text-muted-foreground/60 ml-1.5">
                {plan.period}
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 mb-7">
              {plan.description}
            </p>

            <ul className="space-y-3 mb-8 flex-1">
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2.5 text-sm text-muted-foreground/80"
                >
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-secondary/10 border border-secondary/15">
                    <Check className="h-3 w-3 text-secondary" />
                  </div>
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              variant={plan.current ? "outline" : plan.highlighted ? "glow" : "secondary"}
              className="w-full"
              disabled={plan.current}
            >
              {plan.current ? "Current Plan" : "Upgrade"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
