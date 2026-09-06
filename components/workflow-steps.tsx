import { Check } from "lucide-react";

type WorkflowStep = 1 | 2 | 3 | 4;

const STEPS: { number: WorkflowStep; label: string }[] = [
  { number: 1, label: "Shipment details" },
  { number: 2, label: "Upload documents" },
  { number: 3, label: "Check" },
  { number: 4, label: "Results" },
];

export function WorkflowSteps({
  currentStep,
}: {
  currentStep: WorkflowStep;
}) {
  return (
    <nav
      aria-label="Shipment check progress"
      className="mb-6 rounded-xl border bg-card px-3 py-4 sm:px-5"
    >
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((step) => {
          const complete = step.number < currentStep;
          const current = step.number === currentStep;

          return (
            <li
              key={step.number}
              aria-current={current ? "step" : undefined}
              className="flex min-w-0 flex-col items-center gap-2 text-center"
            >
              <span
                className={`flex size-7 items-center justify-center rounded-full border text-xs font-semibold sm:size-8 ${
                  complete
                    ? "border-green-600 bg-green-600 text-white"
                    : current
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {complete ? <Check className="size-4" /> : step.number}
              </span>
              <span
                className={`text-[11px] leading-tight sm:text-xs ${
                  current
                    ? "font-semibold text-foreground"
                    : complete
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
