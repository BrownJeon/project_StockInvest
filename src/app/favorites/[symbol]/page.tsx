import { FavoriteDetailPage } from './FavoriteDetailPage';

interface Props {
  params: { symbol: string };
}

export default function Page({ params }: Props) {
  return <FavoriteDetailPage symbol={decodeURIComponent(params.symbol)} />;
}
