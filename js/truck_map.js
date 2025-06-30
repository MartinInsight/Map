class TruckCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId, {
            zoomControl: false // 기본 줌 컨트롤 비활성화
        }).setView([37.8, -96], 4);
        this.stateLayer = null;
        this.currentMode = 'inbound';
        this.metricData = null;
        this.geoJsonData = null;
        this.initialized = false;
        this.errorControl = null;
        this.isZoomingToState = false; // 필터 선택으로 확대 중인지 추적하는 플래그
        this.lockedStateId = null; // 필터로 선택되어 '잠긴' 주의 ID를 추적하는 플래그
        this.currentOpenPopup = null; // 현재 열려있는 팝업에 대한 참조 추가
        this.rightControlsInstance = null; // 통합된 우측 컨트롤 인스턴스

        // 지도 타일 레이어를 CartoDB Light All로 변경하여 영어 지명 통일
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        this.map.on('zoomend', () => {
            const currentZoom = this.map.getZoom();
            if (currentZoom < this.map.getMinZoom()) {
                this.map.setZoom(this.map.getMinZoom());
            }
        });

        // 팝업이 닫힐 때 currentOpenPopup 참조를 초기화합니다.
        this.map.on('popupclose', (e) => {
            if (this.currentOpenPopup && e.popup === this.currentOpenPopup) {
                this.currentOpenPopup = null;
            }
        });

        this.init();
    }

    async init() {
        try {
            const [geoJson, sheetData] = await Promise.all([
                fetch('data/us-states.json').then(res => {
                    if (!res.ok) throw new Error("GeoJSON fetch error");
                    return res.json();
                }),
                this.fetchSheetData()
            ]);

            this.geoJsonData = geoJson;
            this.metricData = sheetData;

            this.renderMap();
            this.addRightControls();
            this.initialized = true;
        } catch (err) {
            console.error("Initialization failed:", err);
            this.showError("Failed to load truck data. Please try again later.");
        }
    }

    async fetchSheetData() {
        try {
            const res = await fetch('data/us-truck.json');
            if (!res.ok) throw new Error("Truck data fetch error");
            return await res.json();
        } catch (err) {
            console.warn("Truck data fetch failed, using fallback data.");
            return {
                'AL': { name: 'Alabama', inboundDelay: 0, inboundColor: 0, outboundDelay: 0, outboundColor: 0, dwellInbound: 0, dwellOutbound: 0 },
                'TN': { name: 'Tennessee', inboundDelay: 0, inboundColor: 0, outboundDelay: 0, outboundColor: 0, dwellInbound: 0, dwellOutbound: 0 }
            };
        }
    }

    renderMap() {
        if (this.stateLayer) this.map.removeLayer(this.stateLayer);

        this.stateLayer = L.geoJSON(this.geoJsonData, {
            style: this.getStyle.bind(this),
            onEachFeature: this.bindEvents.bind(this)
        }).addTo(this.map);
    }

    getStyle(feature) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};
        const colorValue = this.currentMode === 'inbound'
            ? data.inboundColor
            : data.outboundColor;

        return {
            fillColor: this.getColor(colorValue),
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.7
        };
    }

    getColor(value) {
        const colors = {
            '-3': '#d73027',
            '-2': '#f46d43',
            '-1': '#fdae61',
            '0': '#ffffbf',
            '1': '#a6d96a',
            '2': '#66bd63',
            '3': '#1a9850'
        };
        return colors[String(value)] || '#cccccc';
    }

    bindEvents(feature, layer) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};

        layer.on({
            mouseover: (e) => {
                if (this.isZoomingToState || this.lockedStateId) return;

                let center = layer.getBounds().getCenter();
                // 알래스카 (AK)와 하와이 (HI)에 대한 툴팁 위치 수동 조정
                if (stateCode === 'AK') {
                    center = L.latLng(62.0, -150.0);
                } else if (stateCode === 'HI') {
                    center = L.latLng(20.7, -157.5); // 하와이 툴팁 위치 조정
                }

                this.showTooltip(center, data);
                layer.setStyle({
                    weight: 2,
                    color: 'white',
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                if (this.lockedStateId) return;

                if (this.currentOpenPopup) {
                    const toElement = e.originalEvent.relatedTarget;
                    if (this.currentOpenPopup.getElement() && this.currentOpenPopup.getElement().contains(toElement)) {
                        return;
                    }
                }

                this.map.closePopup();
                this.currentOpenPopup = null;
                this.stateLayer.resetStyle(layer);
            },
            click: (e) => {
                const clickedStateId = feature.id;
                const stateData = this.metricData[clickedStateId] || {};

                this.map.closePopup();
                this.currentOpenPopup = null;

                if (this.lockedStateId && this.lockedStateId !== clickedStateId) {
                    this.stateLayer.eachLayer(currentLayer => {
                        if (currentLayer.feature.id === this.lockedStateId) {
                            this.stateLayer.resetStyle(currentLayer);
                        }
                    });
                    this.lockedStateId = null;
                    const filter = document.querySelector('.state-filter');
                    if (filter) filter.value = '';
                }

                // 확대/이동 로직 개선: 알래스카, 하와이와 일반 주 구분
                this.isZoomingToState = true;
                this.lockedStateId = clickedStateId;

                if (clickedStateId === 'AK') {
                    this.map.setView([62.0, -150.0], 4, { animate: true, duration: 0.5 });
                } else if (clickedStateId === 'HI') {
                    this.map.setView([20.7, -157.5], 6, { animate: true, duration: 0.5 }); // 하와이는 줌 레벨 6으로 고정
                } else {
                    const bounds = L.geoJSON(feature).getBounds();
                    this.map.fitBounds(bounds, {
                        paddingTopLeft: [50, 50],
                        paddingBottomRight: [50, 50],
                        maxZoom: 6,
                        animate: true,
                        duration: 0.5
                    });
                }

                this.map.once('moveend', () => {
                    this.map.invalidateSize(true);

                    let tooltipCenter = L.geoJSON(feature).getBounds().getCenter();
                    if (clickedStateId === 'AK') {
                        tooltipCenter = L.latLng(62.0, -150.0);
                    } else if (clickedStateId === 'HI') {
                        tooltipCenter = L.latLng(20.7, -157.5);
                    }

                    setTimeout(() => {
                        this.showTooltip(tooltipCenter, stateData);
                        this.stateLayer.eachLayer(layer => {
                            if (layer.feature.id === clickedStateId) {
                                layer.setStyle({
                                    weight: 2,
                                    color: 'white',
                                    dashArray: '',
                                    fillOpacity: 0.9
                                });
                            } else {
                                this.stateLayer.resetStyle(layer);
                            }
                        });
                        this.isZoomingToState = false;
                    }, 200); // 충분한 지연
                });

                const filter = document.querySelector('.state-filter');
                if (filter) filter.value = clickedStateId;
            }
        });
    }

    showTooltip(latlng, data) {
        if (!this.initialized || !data.name) return;

        this.map.closePopup();
        this.currentOpenPopup = null;

        let adjustedLatLng = latlng;
        // 알래스카와 하와이 툴팁 위치 조정 (기존 로직 유지)
        if (data.name === 'Alaska') {
            adjustedLatLng = L.latLng(62.0, -150.0);
        } else if (data.name === 'Hawaii') {
            adjustedLatLng = L.latLng(20.7, -157.5);
        }

        const format = (v) => isNaN(Number(v)) ? '0.00' : Math.abs(Number(v)).toFixed(2);
        const isInbound = this.currentMode === 'inbound';
        const delay = isInbound ? data.inboundDelay : data.outboundDelay;
        const dwellValue = isInbound ? data.dwellInbound : data.outboundDwell;

        const content = `
            <h4>${data.name || 'Unknown'}</h4>
            <div>
                <strong>Truck Movement</strong>
                <p class="${delay >= 0 ? 'truck-positive' : 'truck-negative'}">
                    ${delay >= 0 ? '↑' : '↓'} ${format(delay)}%
                    <span class="truck-normal-text">${delay >= 0 ? 'above' : 'below'} 2-week avg</span>
                </p>
            </div>
            <div>
                <strong>Dwell Time</strong>
                <p class="${dwellValue >= 0 ? 'truck-positive' : 'truck-negative'}">
                    ${dwellValue >= 0 ? '↑' : '↓'} ${format(dwellValue)}%
                    <span class="truck-normal-text">${dwellValue >= 0 ? 'above' : 'below'} 2-week avg</span>
                </p>
            </div>
        `;

        this.currentOpenPopup = L.popup({
            className: 'truck-tooltip-container',
            maxWidth: 300,
            autoClose: false,
            closeButton: false,
            closeOnClick: false,
            offset: L.point(0, -10)
        })
        .setLatLng(adjustedLatLng)
        .setContent(content);

        this.currentOpenPopup.openOn(this.map);
    }

    zoomToState(feature) {
        const bounds = L.geoJSON(feature).getBounds();
        this.map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] });
    }

    addRightControls() {
        if (this.rightControlsInstance) {
            this.map.removeControl(this.rightControlsInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            const zoomControl = L.DomUtil.create('div', 'leaflet-control-zoom');
            zoomControl.innerHTML = `
                <a class="leaflet-control-zoom-in" href="#" title="Zoom in">+</a>
                <a class="leaflet-control-zoom-out" href="#" title="Zoom out">-</a>
            `;
            div.appendChild(zoomControl);

            L.DomEvent.on(zoomControl.querySelector('.leaflet-control-zoom-in'), 'click', (e) => {
                L.DomEvent.preventDefault(e);
                this.map.zoomIn();
            });
            L.DomEvent.on(zoomControl.querySelector('.leaflet-control-zoom-out'), 'click', (e) => {
                L.DomEvent.preventDefault(e);
                this.map.zoomOut();
            });

            const resetButtonHtml = `<button class="truck-reset-btn reset-btn">Reset View</button>`;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            L.DomEvent.on(div.querySelector('.truck-reset-btn'), 'click', () => {
                this.lockedStateId = null;
                this.map.setView([37.8, -96], 4);
                const stateFilter = div.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
                this.map.closePopup();
                this.currentOpenPopup = null;
                this.stateLayer.resetStyle();
            });

            const toggleButtonsHtml = `
                <div class="map-control-container truck-toggle-map-control">
                    <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" data-mode="inbound">IN</button>
                    <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" data-mode="outbound">OUT</button>
                </div>
            `;
            div.insertAdjacentHTML('beforeend', toggleButtonsHtml);

            div.querySelectorAll('.truck-toggle-btn').forEach(btn => {
                L.DomEvent.on(btn, 'click', () => {
                    this.currentMode = btn.dataset.mode;
                    div.querySelectorAll('.truck-toggle-btn').forEach(innerBtn => {
                        innerBtn.classList.toggle('truck-active', innerBtn.dataset.mode === this.currentMode);
                    });
                    this.stateLayer.setStyle(this.getStyle.bind(this));
                    this.map.closePopup();
                    this.currentOpenPopup = null;
                    if (this.lockedStateId) {
                        const lockedFeature = this.geoJsonData.features.find(f => f.id === this.lockedStateId);
                        if (lockedFeature) {
                            let center = L.geoJSON(lockedFeature).getBounds().getCenter();
                            const stateData = this.metricData[this.lockedStateId] || {};
                            if (this.lockedStateId === 'AK') {
                                center = L.latLng(62.0, -150.0);
                            } else if (this.lockedStateId === 'HI') {
                                center = L.latLng(20.7, -157.5); // 하와이 툴팁 위치 조정
                            }
                            this.map.invalidateSize(true);
                            setTimeout(() => {
                                this.showTooltip(center, stateData);
                            }, 100);
                        }
                    }
                });
            });

            const states = this.geoJsonData.features
                .map(f => ({ id: f.id, name: f.properties.name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const filterDropdownHtml = `<select class="state-filter"><option value="">Select State</option>${states.map(state => `<option value="${state.id}">${state.name}</option>`).join('')}</select>`;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            L.DomEvent.on(div.querySelector('.state-filter'), 'change', (e) => {
                const stateId = e.target.value;
                this.map.closePopup();
                this.currentOpenPopup = null;

                if (this.lockedStateId) {
                    this.stateLayer.eachLayer(currentLayer => {
                        if (currentLayer.feature.id === this.lockedStateId) {
                            this.stateLayer.resetStyle(currentLayer);
                        }
                    });
                }

                if (!stateId) {
                    this.lockedStateId = null;
                    this.map.setView([37.8, -96], 4);
                    this.stateLayer.resetStyle();
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    this.isZoomingToState = true;
                    this.lockedStateId = stateId;

                    let tooltipCenter;
                    const stateData = this.metricData[stateId] || {};

                    // 알래스카, 하와이 특별 처리
                    if (stateId === 'AK') {
                        this.map.setView([62.0, -150.0], 4, { animate: true, duration: 0.5 });
                        tooltipCenter = L.latLng(62.0, -150.0);
                    } else if (stateId === 'HI') {
                        this.map.setView([20.7, -157.5], 6, { animate: true, duration: 0.5 }); // 하와이 줌 레벨 6으로 고정
                        tooltipCenter = L.latLng(20.7, -157.5);
                    } else {
                        const bounds = L.geoJSON(state).getBounds();
                        this.map.fitBounds(bounds, {
                            paddingTopLeft: [50, 50],
                            paddingBottomRight: [50, 50],
                            maxZoom: 6,
                            animate: true,
                            duration: 0.5
                        });
                        tooltipCenter = bounds.getCenter();
                    }

                    this.map.once('moveend', () => {
                        this.map.invalidateSize(true);
                        setTimeout(() => {
                            this.showTooltip(tooltipCenter, stateData); // 이미 위에서 계산된 tooltipCenter 사용
                            this.stateLayer.eachLayer(layer => {
                                if (layer.feature.id === stateId) {
                                    layer.setStyle({
                                        weight: 2,
                                        color: 'white',
                                        dashArray: '',
                                        fillOpacity: 0.9
                                    });
                                } else {
                                    this.stateLayer.resetStyle(layer);
                                }
                            });
                            this.isZoomingToState = false;
                        }, 100);
                    });
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.rightControlsInstance = control;
            return div;
        };

        control.addTo(this.map);
    }

    showError(message) {
        if (this.errorControl) {
            this.map.removeControl(this.errorControl);
        }

        const errorControl = L.control({ position: 'topleft' });
        errorControl.onAdd = function() {
            const div = L.DomUtil.create('div', 'error-message');
            div.innerHTML = message;
            return div;
        };
        errorControl.addTo(this.map);
        this.errorControl = errorControl;
    }
}

window.TruckCongestionMap = TruckCongestionMap;
