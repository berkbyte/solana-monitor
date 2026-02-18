// Solana Globe — Canvas 2D globe showing validator/network distribution
// Lightweight globe renderer without WebGL dependencies

export interface GlobeNode {
  lat: number;
  lng: number;
  label: string;
  size: number;
  color: string;
  category: 'validator' | 'depin' | 'defi' | 'rpc';
}

// Known Solana validator/datacenter locations (approximate)
const VALIDATOR_NODES: GlobeNode[] = [
  // North America
  { lat: 40.7128, lng: -74.0060, label: 'New York (Equinix)', size: 8, color: '#14F195', category: 'validator' },
  { lat: 37.7749, lng: -122.4194, label: 'San Francisco', size: 6, color: '#14F195', category: 'validator' },
  { lat: 33.7490, lng: -84.3880, label: 'Atlanta', size: 5, color: '#14F195', category: 'validator' },
  { lat: 41.8781, lng: -87.6298, label: 'Chicago', size: 7, color: '#14F195', category: 'validator' },
  { lat: 39.0438, lng: -77.4874, label: 'Ashburn, VA (AWS)', size: 9, color: '#14F195', category: 'validator' },
  { lat: 47.6062, lng: -122.3321, label: 'Seattle', size: 4, color: '#14F195', category: 'validator' },
  { lat: 25.7617, lng: -80.1918, label: 'Miami', size: 4, color: '#14F195', category: 'validator' },
  { lat: 45.5017, lng: -73.5673, label: 'Montreal', size: 3, color: '#14F195', category: 'validator' },
  { lat: 32.7767, lng: -96.7970, label: 'Dallas', size: 5, color: '#14F195', category: 'validator' },
  { lat: 33.4484, lng: -112.0740, label: 'Phoenix', size: 3, color: '#14F195', category: 'validator' },

  // Europe
  { lat: 50.1109, lng: 8.6821, label: 'Frankfurt (Equinix)', size: 7, color: '#9945FF', category: 'validator' },
  { lat: 52.3676, lng: 4.9041, label: 'Amsterdam', size: 6, color: '#9945FF', category: 'validator' },
  { lat: 51.5074, lng: -0.1278, label: 'London', size: 6, color: '#9945FF', category: 'validator' },
  { lat: 48.8566, lng: 2.3522, label: 'Paris', size: 4, color: '#9945FF', category: 'validator' },
  { lat: 59.3293, lng: 18.0686, label: 'Stockholm', size: 3, color: '#9945FF', category: 'validator' },
  { lat: 46.9480, lng: 7.4474, label: 'Bern (Hetzner)', size: 5, color: '#9945FF', category: 'validator' },
  { lat: 55.6761, lng: 12.5683, label: 'Copenhagen', size: 2, color: '#9945FF', category: 'validator' },
  { lat: 50.8503, lng: 4.3517, label: 'Brussels', size: 2, color: '#9945FF', category: 'validator' },
  { lat: 52.5200, lng: 13.4050, label: 'Berlin', size: 3, color: '#9945FF', category: 'validator' },

  // Asia
  { lat: 35.6762, lng: 139.6503, label: 'Tokyo', size: 6, color: '#00D1FF', category: 'validator' },
  { lat: 1.3521, lng: 103.8198, label: 'Singapore', size: 5, color: '#00D1FF', category: 'validator' },
  { lat: 22.3193, lng: 114.1694, label: 'Hong Kong', size: 4, color: '#00D1FF', category: 'validator' },
  { lat: 37.5665, lng: 126.9780, label: 'Seoul', size: 3, color: '#00D1FF', category: 'validator' },
  { lat: 13.7563, lng: 100.5018, label: 'Bangkok', size: 2, color: '#00D1FF', category: 'validator' },
  { lat: 19.0760, lng: 72.8777, label: 'Mumbai', size: 3, color: '#00D1FF', category: 'validator' },
  { lat: 25.2048, lng: 55.2708, label: 'Dubai', size: 3, color: '#00D1FF', category: 'validator' },

  // South America
  { lat: -23.5505, lng: -46.6333, label: 'São Paulo', size: 4, color: '#FFD700', category: 'validator' },
  { lat: -34.6037, lng: -58.3816, label: 'Buenos Aires', size: 2, color: '#FFD700', category: 'validator' },
  { lat: 4.7110, lng: -74.0721, label: 'Bogotá', size: 2, color: '#FFD700', category: 'validator' },

  // Oceania
  { lat: -33.8688, lng: 151.2093, label: 'Sydney', size: 3, color: '#FF6B6B', category: 'validator' },
  { lat: -41.2865, lng: 174.7762, label: 'Wellington', size: 1, color: '#FF6B6B', category: 'validator' },
];

export class SolanaGlobe {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rotationX = 0; // latitude rotation
  private rotationY = 0; // longitude rotation
  private autoRotateSpeed = 0.002;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private animationFrame: number | null = null;
  private nodes: GlobeNode[] = [...VALIDATOR_NODES];
  private hoveredNode: GlobeNode | null = null;
  private tooltipEl: HTMLElement;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'solana-globe-canvas';
    this.canvas.style.cssText = 'width: 100%; height: 100%; cursor: grab;';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'globe-tooltip';
    this.tooltipEl.style.cssText = 'position: absolute; display: none; background: rgba(0,0,0,0.85); color: #14F195; padding: 4px 8px; border-radius: 4px; font-size: 11px; pointer-events: none; z-index: 100; border: 1px solid rgba(20,241,149,0.3);';
    container.style.position = 'relative';
    container.appendChild(this.tooltipEl);

    this.setupInteraction();
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.startAnimation();
  }

  private resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private setupInteraction(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.rotationY += dx * 0.005;
        this.rotationX -= dy * 0.005;
        this.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotationX));
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }

      // Tooltip on hover
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.checkHover(mx, my);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    });

    // Touch support
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastMouseX = e.touches[0]!.clientX;
        this.lastMouseY = e.touches[0]!.clientY;
      }
    });

    this.canvas.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0]!.clientX - this.lastMouseX;
        const dy = e.touches[0]!.clientY - this.lastMouseY;
        this.rotationY += dx * 0.005;
        this.rotationX -= dy * 0.005;
        this.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotationX));
        this.lastMouseX = e.touches[0]!.clientX;
        this.lastMouseY = e.touches[0]!.clientY;
      }
    });

    this.canvas.addEventListener('touchend', () => {
      this.isDragging = false;
    });
  }

  private checkHover(mx: number, my: number): void {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.38;

    let closest: GlobeNode | null = null;
    let minDist = Infinity;

    for (const node of this.nodes) {
      const pos = this.projectNode(node, cx, cy, radius);
      if (!pos.visible) continue;
      const dx = mx - pos.x;
      const dy = my - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 12 && dist < minDist) {
        closest = node;
        minDist = dist;
      }
    }

    if (closest !== this.hoveredNode) {
      this.hoveredNode = closest;
      if (closest) {
        this.tooltipEl.textContent = closest.label;
        this.tooltipEl.style.display = 'block';
        const pos = this.projectNode(closest, cx, cy, radius);
        this.tooltipEl.style.left = `${pos.x + 10}px`;
        this.tooltipEl.style.top = `${pos.y - 10}px`;
      } else {
        this.tooltipEl.style.display = 'none';
      }
    }
  }

  private projectNode(node: GlobeNode, cx: number, cy: number, radius: number): { x: number; y: number; z: number; visible: boolean } {
    const lat = (node.lat * Math.PI) / 180;
    const lng = (node.lng * Math.PI) / 180;

    // 3D position on unit sphere
    let x = Math.cos(lat) * Math.sin(lng + this.rotationY);
    let y = -Math.sin(lat + this.rotationX);
    let z = Math.cos(lat) * Math.cos(lng + this.rotationY);

    // Apply X rotation
    const cosRx = Math.cos(this.rotationX);
    const sinRx = Math.sin(this.rotationX);
    const y2 = y * cosRx - z * sinRx;
    const z2 = y * sinRx + z * cosRx;
    y = y2;
    z = z2;

    return {
      x: cx + x * radius,
      y: cy + y * radius,
      z,
      visible: z > -0.1, // visible if on front half
    };
  }

  private startAnimation(): void {
    const draw = () => {
      this.render();
      if (!this.isDragging) {
        this.rotationY += this.autoRotateSpeed;
      }
      this.animationFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  private render(): void {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.38;

    this.ctx.clearRect(0, 0, w, h);

    // Draw globe sphere
    this.drawGlobe(cx, cy, radius);

    // Draw grid lines
    this.drawGrid(cx, cy, radius);

    // Draw nodes
    this.drawNodes(cx, cy, radius);

    // Draw stats overlay
    this.drawStats(w, h);
  }

  private drawGlobe(cx: number, cy: number, radius: number): void {
    // Outer glow
    const glow = this.ctx.createRadialGradient(cx, cy, radius * 0.9, cx, cy, radius * 1.3);
    glow.addColorStop(0, 'rgba(20, 241, 149, 0.05)');
    glow.addColorStop(1, 'rgba(20, 241, 149, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(0, 0, cx * 2, cy * 2);

    // Globe fill
    const gradient = this.ctx.createRadialGradient(cx - radius * 0.2, cy - radius * 0.2, 0, cx, cy, radius);
    gradient.addColorStop(0, 'rgba(20, 241, 149, 0.08)');
    gradient.addColorStop(0.7, 'rgba(20, 241, 149, 0.03)');
    gradient.addColorStop(1, 'rgba(20, 241, 149, 0.01)');
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    this.ctx.fill();

    // Globe border
    this.ctx.strokeStyle = 'rgba(20, 241, 149, 0.25)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  private drawGrid(cx: number, cy: number, radius: number): void {
    this.ctx.strokeStyle = 'rgba(20, 241, 149, 0.08)';
    this.ctx.lineWidth = 0.5;

    // Longitude lines
    for (let lng = -180; lng < 180; lng += 30) {
      this.ctx.beginPath();
      let started = false;
      for (let lat = -90; lat <= 90; lat += 3) {
        const pos = this.projectNode({ lat, lng, label: '', size: 0, color: '', category: 'validator' }, cx, cy, radius);
        if (pos.visible) {
          if (!started) {
            this.ctx.moveTo(pos.x, pos.y);
            started = true;
          } else {
            this.ctx.lineTo(pos.x, pos.y);
          }
        } else {
          started = false;
        }
      }
      this.ctx.stroke();
    }

    // Latitude lines
    for (let lat = -60; lat <= 60; lat += 30) {
      this.ctx.beginPath();
      let started = false;
      for (let lng = -180; lng <= 180; lng += 3) {
        const pos = this.projectNode({ lat, lng, label: '', size: 0, color: '', category: 'validator' }, cx, cy, radius);
        if (pos.visible) {
          if (!started) {
            this.ctx.moveTo(pos.x, pos.y);
            started = true;
          } else {
            this.ctx.lineTo(pos.x, pos.y);
          }
        } else {
          started = false;
        }
      }
      this.ctx.stroke();
    }
  }

  private drawNodes(cx: number, cy: number, radius: number): void {
    // Sort by z so front nodes render on top
    const projected = this.nodes.map(node => ({
      node,
      ...this.projectNode(node, cx, cy, radius),
    })).filter(p => p.visible).sort((a, b) => a.z - b.z);

    for (const { node, x, y, z } of projected) {
      const alpha = 0.3 + 0.7 * ((z + 1) / 2); // fade with depth
      const size = node.size * (0.6 + 0.4 * ((z + 1) / 2));

      // Glow
      const glow = this.ctx.createRadialGradient(x, y, 0, x, y, size * 3);
      glow.addColorStop(0, `${node.color}${Math.round(alpha * 40).toString(16).padStart(2, '0')}`);
      glow.addColorStop(1, `${node.color}00`);
      this.ctx.fillStyle = glow;
      this.ctx.fillRect(x - size * 3, y - size * 3, size * 6, size * 6);

      // Dot
      this.ctx.fillStyle = node.color;
      this.ctx.globalAlpha = alpha;
      this.ctx.beginPath();
      this.ctx.arc(x, y, size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalAlpha = 1;

      // Pulse ring for hovered
      if (node === this.hoveredNode) {
        this.ctx.strokeStyle = node.color;
        this.ctx.lineWidth = 1.5;
        this.ctx.globalAlpha = 0.6;
        this.ctx.beginPath();
        this.ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.globalAlpha = 1;
      }
    }
  }

  private drawStats(w: number, h: number): void {
    this.ctx.fillStyle = 'rgba(20, 241, 149, 0.7)';
    this.ctx.font = '10px monospace';
    this.ctx.textAlign = 'left';

    const stats = [
      `VALIDATORS: ~1,900`,
      `REGIONS: ${new Set(this.nodes.map(n => n.color)).size}`,
      `NODES: ${this.nodes.length}`,
    ];

    stats.forEach((stat, i) => {
      this.ctx.fillText(stat, 8, h - 8 - (stats.length - 1 - i) * 14);
    });

    // Legend
    this.ctx.textAlign = 'right';
    const legend = [
      { color: '#14F195', label: 'North America' },
      { color: '#9945FF', label: 'Europe' },
      { color: '#00D1FF', label: 'Asia' },
      { color: '#FFD700', label: 'South America' },
      { color: '#FF6B6B', label: 'Oceania' },
    ];

    legend.forEach((item, i) => {
      this.ctx.fillStyle = item.color;
      this.ctx.fillRect(w - 100, 8 + i * 16, 8, 8);
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      this.ctx.fillText(item.label, w - 8, 16 + i * 16);
    });
  }

  public setMode(mode: string): void {
    // Filter nodes based on mode
    if (mode === 'validators') {
      this.nodes = VALIDATOR_NODES.filter(n => n.category === 'validator');
    } else {
      this.nodes = [...VALIDATOR_NODES];
    }
  }

  public destroy(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.resizeObserver.disconnect();
    this.canvas.remove();
    this.tooltipEl.remove();
  }
}
