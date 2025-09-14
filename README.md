# ShopCompare - Price Comparison & Shopping Assistant

A comprehensive MERN stack application for price comparison and shopping assistance across multiple e-commerce platforms.

## Features

- 🔍 **Multi-platform Search**: Search across Amazon, Flipkart, Myntra, and more
- 💰 **Price Tracking**: Real-time price monitoring and alerts
- 📊 **Price History**: Visual charts showing price trends over time
- 👀 **Watchlist**: Track favorite products and get notified of price drops
- 📱 **Mobile-First**: Responsive design optimized for all devices
- 🔔 **Smart Alerts**: Push notifications and email alerts for price changes
- 📈 **Spend Tracking**: Monitor your shopping expenses across platforms
- 🎯 **Smart Matching**: AI-powered product deduplication across platforms

## Tech Stack

### Backend
- **Runtime**: Node.js (LTS)
- **Framework**: Express.js
- **Database**: MongoDB Atlas
- **Cache**: Redis
- **Queue**: BullMQ
- **Authentication**: JWT + OAuth2

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router v6
- **State Management**: React Query + Zustand
- **UI Library**: Material-UI (MUI)
- **Charts**: Recharts

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Orchestration**: Kubernetes
- **CI/CD**: GitHub Actions
- **Monitoring**: Prometheus + Grafana
- **Storage**: AWS S3 compatible

## Quick Start

### Prerequisites
- Node.js 18+ 
- MongoDB 5.0+
- Redis 6.0+
- Docker & Docker Compose

### Development Setup

1. **Clone and install dependencies**:
```bash
git clone <repository-url>
cd shopcompare
npm run setup
```

2. **Environment Configuration**:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Start development servers**:
```bash
docker-compose up -d  # Start MongoDB and Redis
npm run dev           # Start both backend and frontend
```

4. **Access the application**:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000
- Admin Panel: http://localhost:3000/admin

## Project Structure

```
├── backend/                 # Node.js/Express API
│   ├── src/
│   │   ├── controllers/     # Route controllers
│   │   ├── models/         # MongoDB models
│   │   ├── services/       # Business logic
│   │   ├── connectors/     # Platform integrations
│   │   ├── workers/        # Background jobs
│   │   └── middleware/     # Express middleware
│   ├── tests/              # Backend tests
│   └── package.json
├── frontend/               # React application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom hooks
│   │   ├── services/       # API clients
│   │   └── utils/          # Utility functions
│   ├── public/             # Static assets
│   └── package.json
├── docker/                 # Docker configurations
├── k8s/                   # Kubernetes manifests
├── docs/                  # Documentation
└── scripts/               # Deployment scripts
```

## API Documentation

The API documentation is available at:
- Development: http://localhost:5000/api-docs
- OpenAPI Spec: [docs/api/openapi.yaml](docs/api/openapi.yaml)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.