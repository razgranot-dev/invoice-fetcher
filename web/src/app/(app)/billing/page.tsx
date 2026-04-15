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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              "relative flex flex-col transition-all duration-300",
              plan.highlighted
                ? "card-glow accent-strip-primary p-8 hover-lift scale-[1.03] z-10"
                : "card-glow p-7 hover-lift"
            )}
          >
            {plan.highlighted && (
              <div className="absolute -top-px left-6 right-6 h-[3px] bg-gradient-to-r from-primary via-secondary to-primary rounded-b-full" />
            )}

            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black">{plan.name}</h3>
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

            <div className="mb-2">
              <span className="text-5xl font-black tracking-tight">
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
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-secondary/15 border border-secondary/25 shadow-sm shadow-secondary/10">
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
