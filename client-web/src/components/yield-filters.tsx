import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, type SymbolTheme } from "@/lib";

interface YieldFiltersProps {
  allDates: number[];
  selectedStartDate: number;
  onStartDateChange: (date: number) => void;
  allowedSymbols: string[];
  selectedSymbols: string[];
  onToggleSymbol: (symbol: string) => void;
  symbolColors: Record<string, SymbolTheme>;
}

export function YieldFilters({
  allDates,
  selectedStartDate,
  onStartDateChange,
  allowedSymbols,
  selectedSymbols,
  onToggleSymbol,
  symbolColors,
}: YieldFiltersProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Label
          htmlFor="start-date"
          className="text-muted-foreground font-normal"
        >
          Start date
        </Label>
        <Select
          value={String(selectedStartDate)}
          onValueChange={(value) => onStartDateChange(Number(value))}
        >
          <SelectTrigger id="start-date" className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allDates.map((date) => (
              <SelectItem key={date} value={String(date)}>
                {formatDate(date)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {allowedSymbols.map((symbol) => (
          <label
            key={symbol}
            className="flex cursor-pointer items-center gap-1.5 text-sm select-none"
          >
            <Checkbox
              checked={selectedSymbols.includes(symbol)}
              onCheckedChange={() => onToggleSymbol(symbol)}
            />
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: symbolColors[symbol]?.light }}
            />
            {symbol}
          </label>
        ))}
      </div>
    </div>
  );
}
