import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export default function TelemetryChart({ data, lineFilterGroup }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="2 2" stroke="#cbd5e1" vertical={false} />
        <XAxis dataKey="formattedDate" stroke="#44403c" fontSize={11} />
        <YAxis stroke="#44403c" fontSize={11} domain={[0, 'auto']} />
        <Tooltip />
        <Legend />

        {(lineFilterGroup === 'ALL' || lineFilterGroup === 'PHASE_TO_PHASE') && (
          <>
            <Line type="monotone" dataKey="ab_corrected" name="A-B MΩ" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="bc_corrected" name="B-C MΩ" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="ca_corrected" name="C-A MΩ" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
          </>
        )}

        {(lineFilterGroup === 'ALL' || lineFilterGroup === 'PHASE_TO_GROUND') && (
          <>
            <Line type="monotone" dataKey="ag_corrected" name="A-G MΩ" stroke="#d97706" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
            <Line type="monotone" dataKey="bg_corrected" name="B-G MΩ" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
            <Line type="monotone" dataKey="cg_corrected" name="C-G MΩ" stroke="#475569" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
          </>
        )}

        <Line type="monotone" dataKey="ir_min" name="IEEE Limit" stroke="#dc2626" strokeWidth={2} strokeDasharray="2 2" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
