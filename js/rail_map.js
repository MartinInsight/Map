class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.markers = [];
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null; // 필터 컨트롤 인스턴스 저장용

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 18, // 최대 줌 레벨
            minZoom: 2   // 최소 줌 레벨 설정 (고무줄 현상 방지)
        }).addTo(this.map);

        // 지도의 최대 범위를 설정하여 사용자가 특정 영역 밖으로 벗어나지 못하게 함
        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        // 줌 제한 로직 (minZoom과 maxBounds가 함께 작동하도록)
        // 이 로직은 불필요한 줌을 막고, minZoom 설정과 함께 고무줄 현상을 방지합니다.
        this.map.on('zoomend', () => {
            const currentZoom = this.map.getZoom();
            // minZoom보다 작아지려고 하면 minZoom으로 고정
            if (currentZoom < this.map.getMinZoom()) {
                this.map.setZoom(this.map.getMinZoom());
            }
        });

        // 데이터 로드와 관계없는 컨트롤은 먼저 추가합니다 (예: 리셋 버튼)
        this.addControls();
        // 데이터 로드를 시작하고, 로드 완료 후 마커와 필터를 렌더링합니다.
        this.loadData();
    }

    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const rawData = await response.json();

            // 데이터 정규화
            this.currentData = rawData.map(item => ({
                ...item,
                lat: item.lat || item.Latitude,
                lng: item.lng || item.Longitude,
                Yard: item.location || 'Unknown' // 'Yard' 필드가 없다면 'location' 사용
            })).filter(item => item.lat && item.lng && item.Yard); // 유효한 데이터만 필터링

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].date;
            }

            this.renderMarkers();
            this.addLastUpdatedText();
            // 중요: 데이터 로드가 완료된 후에 필터 컨트롤을 추가/갱신합니다.
            this.addFilterControl();
        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("철도 데이터를 로드하지 못했습니다. 잠시 후 다시 시도해주세요.");
        }
    }

    addLastUpdatedText() {
        // 기존 '마지막 업데이트' 컨트롤이 있다면 제거
        if (this.lastUpdatedControl) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        if (this.lastUpdated) {
            const date = new Date(this.lastUpdated);
            const formattedDate = `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;

            const infoControl = L.control({ position: 'bottomleft' });

            infoControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'last-updated-info');
                div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
                return div;
            };

            infoControl.addTo(this.map);
            this.lastUpdatedControl = infoControl; // 인스턴스 저장
        }
    }

    renderMarkers(data = this.currentData) {
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];

        data.forEach(item => {
            const marker = L.circleMarker([item.lat, item.lng], {
                radius: this.getRadiusByIndicator(item.indicator),
                fillColor: this.getColor(item.congestion_level),
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });

            // 마우스 오버/아웃 시 팝업 표시
            marker.on({
                mouseover: (e) => {
                    this.map.closePopup(); // 기존 팝업 닫기
                    const popup = L.popup()
                        .setLatLng(e.latlng)
                        .setContent(this.createPopupContent(item))
                        .openOn(this.map);
                },
                mouseout: () => {
                    this.map.closePopup();
                },
                click: () => {
                    this.map.closePopup();
                }
            });

            marker.addTo(this.map);
            this.markers.push(marker);
        });
    }

    addControls() {
        const controlContainer = L.control({ position: 'topright' });

        controlContainer.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-container');
            div.innerHTML = `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `;

            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4); // 초기 뷰로 되돌리기
                this.renderMarkers(this.currentData); // 모든 데이터로 마커 다시 렌더링
                // 필터 초기화
                if (this.filterControlInstance) {
                    const yardFilter = this.filterControlInstance._container.querySelector('.yard-filter');
                    if (yardFilter) yardFilter.value = '';
                }
            });

            return div;
        };

        controlContainer.addTo(this.map);
    }

    addFilterControl() {
        // 기존 필터 컨트롤이 있다면 제거
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'bottomright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'filter-control');

            // 데이터에서 유효한 야드만 추출 및 정렬
            const validYards = this.currentData
                .filter(item => item.Yard && item.Yard.trim() !== '')
                .map(item => item.Yard);

            const yards = [...new Set(validYards)].sort((a, b) => a.localeCompare(b));

            div.innerHTML = `
                <select class="yard-filter">
                    <option value="">Select Yard</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;

            div.querySelector('.yard-filter').addEventListener('change', (e) => {
                const yardName = e.target.value;
                if (!yardName) {
                    this.map.setView([37.8, -96], 4); // 야드 선택 해제 시 전체 뷰로 돌아가기
                    this.renderMarkers(this.currentData); // 모든 마커 렌더링
                    return;
                }

                const yardData = this.currentData.filter(item => item.Yard === yardName);
                if (yardData.length > 0) {
                    // 야드 중심으로 이동 (고정 줌 레벨 8)
                    const center = this.getYardCenter(yardData);
                    this.map.setView(center, 8);
                    this.renderMarkers(yardData);
                }
            });

            return div;
        };

        control.addTo(this.map);
        this.filterControlInstance = control; // 필터 컨트롤 인스턴스 저장
    }

    getYardCenter(yardData) {
        if (!yardData || yardData.length === 0) return [37.8, -96];

        const lats = yardData.map(item => item.lat);
        const lngs = yardData.map(item => item.lng);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        return [
            (minLat + maxLat) / 2,
            (minLng + maxLng) / 2
        ];
    }

    getRadiusByIndicator(indicator) {
        if (indicator > 2) return 20;
        if (indicator > 1) return 16;
        if (indicator > -1) return 12;
        if (indicator > -2) return 8;
        return 5;
    }

    getColor(level, isText = false) {
        const circleColors = {
            'Very High': '#d62828',
            'High': '#f88c2b',
            'Low': '#5fa9f6',
            'Very Low': '#004fc0',
            'Average': '#bcbcbc' // 'Average' 추가
        };

        const textColors = {
            'Very High': '#6b1414',
            'High': '#7c4616',
            'Low': '#30557b',
            'Very Low': '#002860',
            'Average': '#5e5e5e' // 'Average' 추가
        };

        return isText ? textColors[level] : circleColors[level];
    }

    createPopupContent(data) {
        const level = data.congestion_level || 'Unknown';

        return `
            <div class="rail-tooltip">
                <h4>${data.location || 'Unknown Location'}</h4>
                <p><strong>Company:</strong> ${data.company || 'Unknown'}</p>
                <p><strong>Congestion Level:</strong>
                    <span style="color: ${this.getColor(level, true)}">
                        ${level}
                    </span>
                </p>
                <p><strong>Dwell Time:</strong> ${data.congestion_score?.toFixed(1) || 'N/A'} hours</p>
            </div>
        `;
    }

    // 오류 메시지 표시 함수
    displayErrorMessage(message) {
        // 기존 오류 메시지 컨트롤이 있다면 제거
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
        this.errorControl = errorControl; // 인스턴스 저장
    }
}

window.RailCongestionMap = RailCongestionMap;
