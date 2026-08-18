import { ConvexReactClient } from 'convex/react'

const url = import.meta.env.VITE_CONVEX_URL

if (!url) {
  throw new Error('VITE_CONVEX_URL não definida — ver .env.local.example e o checkpoint 02-04')
}

export const convexClient = new ConvexReactClient(url)
