import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface TrendRow {
  date: string;
  revenue: number;
  cogs: number;
  expenses: number;
  netProfit: number;
}

interface TrendChartProps {
  data: TrendRow[];
  formatMoney: (amount: number) => string;
  formatDate: (date: string) => string;
}

const TrendChart = ({ data, formatMoney, formatDate }: TrendChartProps) => (
  <div className="trend-chart">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} minTickGap={24} />
        <YAxis />
        <Tooltip formatter={(value: number) => formatMoney(value)} labelFormatter={(value) => formatDate(String(value))} />
        <Legend />
        <Bar dataKey="revenue" name="Revenue" fill="#2563eb" />
        <Bar dataKey="cogs" name="COGS" fill="#f59e0b" />
        <Bar dataKey="expenses" name="Expenses" fill="#dc2626" />
        <Bar dataKey="netProfit" name="Net profit" fill="#16a34a" />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default TrendChart;