import { CreditCard, Check } from "lucide-react";
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              "rounded-xl border bg-card p-6 flex flex-col",
              plan.highlighted
                ? "border-primary/30 shadow-lg shadow-primary/5"
                : "border-border"
            )}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">{plan.name}</h3>
              {plan.current && (
                <Badge variant="outline">Current</Badge>
              )}
              {plan.highlighted && (
                <Badge variant="default">Popular</Badge>
              )}
            </div>

            <div className="mb-1">
              <span className="text-3xl font-bold tracking-tight">
                {plan.price}
              </span>
              <span className="text-sm text-muted-foreground ml-1">
                {plan.period}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-6">
              {plan.description}
            </p>

            <ul className="space-y-2.5 mb-6 flex-1">
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Check className="h-3.5 w-3.5 text-secondary shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              variant={plan.current ? "outline" : plan.highlighted ? "default" : "secondary"}
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
