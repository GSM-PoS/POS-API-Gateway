import { config } from '../config/env';

export interface ServiceConfig {
  name: string;
  url: string;
  healthy: boolean;
  lastChecked: number;
}

class ServiceDiscovery {
  private services: Map<string, ServiceConfig> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeServices();
    this.startHealthChecks();
  }

  private initializeServices() {
    const serviceConfigs: ServiceConfig[] = [
      { name: 'auth', url: config.services.authService.url, healthy: true, lastChecked: Date.now() },
      { name: 'payment', url: config.services.paymentService.url, healthy: true, lastChecked: Date.now() },
      { name: 'core', url: config.services.coreService.url, healthy: true, lastChecked: Date.now() },
      { name: 'menu', url: config.services.menuService.url, healthy: true, lastChecked: Date.now() },
      { name: 'notification', url: config.services.notificationService.url, healthy: true, lastChecked: Date.now() },
      { name: 'integration', url: config.services.integrationService.url, healthy: true, lastChecked: Date.now() },
    ];

    serviceConfigs.forEach(service => {
      this.services.set(service.name, service);
    });
  }

  private startHealthChecks() {
    // Health check every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000);
  }

  private async performHealthChecks() {
    for (const [serviceName, service] of this.services.entries()) {
      try {
        const response = await fetch(`${service.url}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        
        const isHealthy = response.ok;
        this.services.set(serviceName, {
          ...service,
          healthy: isHealthy,
          lastChecked: Date.now()
        });
        
        if (!isHealthy) {
          console.warn(`Service ${serviceName} health check failed: ${response.status}`);
        }
      } catch (error) {
        console.error(`Service ${serviceName} health check error:`, error);
        this.services.set(serviceName, {
          ...service,
          healthy: false,
          lastChecked: Date.now()
        });
      }
    }
  }

  public getServiceUrl(serviceName: string): string | null {
    const service = this.services.get(serviceName);
    if (!service || !service.healthy) {
      console.warn(`Service ${serviceName} is not available or unhealthy`);
      return null;
    }
    return service.url;
  }

  public getServices(): ServiceConfig[] {
    return Array.from(this.services.values());
  }

  public isServiceHealthy(serviceName: string): boolean {
    const service = this.services.get(serviceName);
    return service?.healthy || false;
  }

  public cleanup() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}

export const serviceDiscovery = new ServiceDiscovery();