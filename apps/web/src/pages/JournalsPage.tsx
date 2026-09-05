import { Navigate, useParams } from 'react-router-dom';

export function JournalsPage() {
  const { id } = useParams();
  const target = id
    ? `/sessions?tab=history&reportId=${encodeURIComponent(id)}`
    : '/sessions?tab=history';

  return <Navigate to={target} replace />;
}
