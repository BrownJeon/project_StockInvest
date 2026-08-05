import { FavoriteDetailPage } from './FavoriteDetailPage';

interface Props {
  params: Promise<{ symbol: string }>;
}

export default async function Page({ params }: Props) {
  const { symbol } = await params;
  return <FavoriteDetailPage symbol={decodeURIComponent(symbol)} />;
}
