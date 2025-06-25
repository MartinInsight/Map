class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        
        // 클러스터링 설정 최적화
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 20, // 축소된 클러스터 반경
            disableClusteringAtZoom: 7, // 더 낮은 줌 레벨에서 클러스터 해제
            spiderfyOnMaxZoom: true,
            animate: false, // 모바일 성능 향상
            chunkedLoading: true, // 대량의 마커를 위한 성능 최적화
            
            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1;
                let dominantColor = this.getColor('Average');

                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Low': return 2;
                        case 'Very Low': return 1;
                        default: return 0;
                    }
                };

                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData; 
                    if (itemData && itemData.congestion_level) {
                        const currentLevelValue = congestionLevelToValue(itemData.congestion_level);
                        if (currentLevelValue > highestCongestionLevelValue) {
                            highestCongestionLevelValue = currentLevelValue;
                            dominantColor = this.getColor(itemData.congestion_level); 
                        }
                    }
                });

                const childCount = cluster.getChildCount();
                const size = 30 + Math.min(childCount * 0.5, 30);
                
                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center; display: flex; align-items: center; justify-content: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom', 
                    iconSize: new L.Point(size, size)
                });
            }
        });

        // 상태 관리 변수들
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.errorControl = null;
        this.lastUpdatedControl = null;
        this.markerToOpenAfterMove = null;
        this.isMarkerPopupClickedOpen = false; // 클릭으로 열린 팝업 상태 추적

        // 타일 레이어 설정
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        // 지도 경계 설정
        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        // 이벤트 핸들러 설정
        this.setupEventHandlers();
        this.loadData();
    }

    setupEventHandlers() {
        // 맵 클릭 시 열려 있는 팝업 닫기
        this.map.on('click', () => {
            console.log("Map clicked. Closing any open popups.");
            this.map.closePopup();
        });

        // 맵 이동/확대/축소 완료 시 필터링된 마커의 팝업 열기 시도
        this.map.on('moveend zoomend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling.');
                const targetMarker = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null;
                this.pollForMarkerAndOpenPopup(targetMarker);
            }
        });
        
        // 마커가 실제로 지도에 추가될 때 팝업 열기 시도
        this.allMarkers.on('layeradd', (e) => {
            const addedLayer = e.layer;
            if (this.markerToOpenAfterMove && addedLayer.options.itemData && 
                this.markerToOpenAfterMove.options.itemData.Yard === addedLayer.options.itemData.Yard) {
                console.log(`Layer added for queued marker: ${addedLayer.options.itemData.Yard}`);
                this.pollForMarkerAndOpenPopup(addedLayer);
                this.markerToOpenAfterMove = null;
            }
        });
    }

    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            let processedData = rawData.map(item => ({
                lat: parseFloat(item.lat || item.Latitude), 
                lng: parseFloat(item.lng || item.Longitude),
                Yard: item.location || item.Yard || item.Location || 'Unknown', 
                location: item.location || item.Yard || item.Location || 'Unknown Location', 
                company: item.company || item.Railroad || 'Unknown',
                congestion_score: parseFloat(item.congestion_score || item['Dwell Time']),
                indicator: parseFloat(item.indicator || item.Indicator),
                congestion_level: item.congestion_level || item.Category || 'Average',
                date: item.date || item.DateMonth 
            })).filter(item => 
                !isNaN(item.lat) && !isNaN(item.lng) && item.location && item.congestion_level
            );

            // 좌표 중복 처리
            const jitteredData = this.processDuplicateCoordinates(processedData);
            this.currentData = jitteredData;

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].date;
            }

            this.renderMarkers(); 
            this.addRightControls();
            this.addLastUpdatedText();
            this.addLegend();

        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
        }
    }

    processDuplicateCoordinates(data) {
        const coordinateMap = new Map();
        const jitteredData = [];

        data.forEach(item => {
            const coordKey = `${item.lat},${item.lng}`;
            if (!coordinateMap.has(coordKey)) {
                coordinateMap.set(coordKey, []);
            }
            coordinateMap.get(coordKey).push(item);
        });

        coordinateMap.forEach(itemsAtCoord => {
            if (itemsAtCoord.length > 1) {
                const baseLat = itemsAtCoord[0].lat;
                const baseLng = itemsAtCoord[0].lng;
                const offsetScale = 0.1;

                itemsAtCoord.forEach((item, index) => {
                    const angle = (index / itemsAtCoord.length) * 2 * Math.PI;
                    item.lat = baseLat + (Math.cos(angle) * offsetScale);
                    item.lng = baseLng + (Math.sin(angle) * offsetScale);
                    jitteredData.push(item);
                });
            } else {
                jitteredData.push(itemsAtCoord[0]);
            }
        });

        return jitteredData;
    }

    renderMarkers(data = this.currentData) {
        if (!data || data.length === 0) {
            console.warn("No data to render. Clearing map layers.");
            this.allMarkers.clearLayers();
            if (this.map.hasLayer(this.allMarkers)) {
                this.map.removeLayer(this.allMarkers);
            }
            return;
        }

        this.allMarkers.clearLayers();

        data.forEach(item => {
            const marker = this.createSingleMarker(item);
            this.allMarkers.addLayer(marker);
        });

        if (!this.map.hasLayer(this.allMarkers)) {
            this.map.addLayer(this.allMarkers);
        }
        
        // 클러스터 클릭 핸들러
        this.allMarkers.off('clusterclick');
        this.allMarkers.on('clusterclick', (a) => {
            console.log("Cluster clicked, zooming to bounds.");
            a.layer.zoomToBounds();
        });

        // PC 전용 클러스터 호버 핸들러
        if (!L.Browser.mobile) {
            this.setupClusterHoverHandlers();
        }
    }

    setupClusterHoverHandlers() {
        this.allMarkers.off('clustermouseover');
        this.allMarkers.on('clustermouseover', (a) => {
            if (this.isMarkerPopupClickedOpen) return; // 이미 클릭 팝업이 열려있으면 무시

            const childCount = a.layer.getChildCount();
            const popupContent = `
                <div class="cluster-hover-info">
                    <h4>${childCount} Locations Clustered</h4>
                    <p>Click or zoom in to see individual details.</p>
                </div>
            `;

            L.popup({
                closeButton: false,
                autoClose: true,
                closeOnClick: false,
                maxHeight: 300,
                maxWidth: 300
            })
            .setLatLng(a.latlng)
            .setContent(popupContent)
            .openOn(this.map);
        });

        this.allMarkers.off('clustermouseout');
        this.allMarkers.on('clustermouseout', () => {
            this.map.closePopup();
        });
    }

    createSingleMarker(item) {
        const level = item.congestion_level || 'Average';
        const color = this.getColor(level);
        const radius = this.getRadiusByIndicator(item.indicator);

        const iconHtml = `
            <div style="
                background-color: ${color}; 
                width: ${radius * 2}px; 
                height: ${radius * 2}px; 
                border-radius: 50%; 
                border: 1.5px solid white; 
                box-shadow: 0 0 3px rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
            "></div>
        `;

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: [radius * 2, radius * 2],
            iconAnchor: [radius, radius]
        });

        const marker = L.marker([item.lat, item.lng], { 
            icon: customIcon,
            itemData: item,
            riseOnHover: true
        });

        const popupOptions = {
            closeButton: true,
            autoClose: false, // 수동으로 닫을 때까지 유지
            closeOnClick: false, // 지도 클릭 시 닫히지 않음
            maxHeight: 300,
            maxWidth: 300,
            className: 'rail-congestion-popup'
        };

        marker.bindPopup(this.createPopupContent([item]), popupOptions);
        
        // 팝업 이벤트 핸들러
        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.Yard} opened.`);
            this.isMarkerPopupClickedOpen = true;
            e.popup.getElement().style.zIndex = 10000;
        });

        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.Yard} closed.`);
            this.isMarkerPopupClickedOpen = false;
        });

        // PC 전용 호버 이벤트
        if (!L.Browser.mobile) {
            this.setupDesktopHoverEvents(marker);
        }

        // 공통 클릭/탭 이벤트
        this.setupClickEvents(marker, item);

        return marker;
    }

    setupDesktopHoverEvents(marker) {
        marker.on('mouseover', () => {
            if (this.isMarkerPopupClickedOpen) return;
            
            console.log("PC: Mouseover on marker.");
            this.map.closePopup();
            marker.openPopup();
        });

        marker.on('mouseout', () => {
            if (this.isMarkerPopupClickedOpen) return;
            
            console.log("PC: Mouseout from marker.");
            setTimeout(() => {
                if (marker.getPopup() && marker.getPopup().isOpen()) {
                    marker.closePopup();
                }
            }, 50);
        });
    }

    setupClickEvents(marker, item) {
        marker.on(L.Browser.touch ? 'click' : 'click', (e) => {
            L.DomEvent.stopPropagation(e);
            console.log(`${L.Browser.touch ? 'Mobile' : 'PC'}: Clicked marker: ${item.Yard}`);

            if (marker.getPopup().isOpen()) {
                marker.closePopup();
            } else {
                this.map.closePopup();
                setTimeout(() => {
                    if (marker && marker._map) {
                        marker.openPopup();
                        if (!marker.getPopup().isOpen()) {
                            console.warn("Popup did not open, trying fallback.");
                            this.map.openPopup(marker.getPopup());
                        }
                    }
                }, L.Browser.touch ? 150 : 0); // 모바일에서는 약간의 지연 추가
            }
        });
    }

    pollForMarkerAndOpenPopup(marker) {
        if (!marker || !marker.getPopup()) {
            console.warn("Invalid marker or no popup.");
            return;
        }

        this.map.closePopup();

        let attempts = 0;
        const maxAttempts = 30;
        const retryInterval = 100;

        const checkAndOpen = () => {
            if (marker._icon && marker._map) {
                console.log(`Opening popup for ${marker.options.itemData.Yard}`);
                marker.openPopup();
                
                if (!marker.getPopup().isOpen()) {
                    console.warn("Popup not open, using fallback.");
                    this.map.openPopup(marker.getPopup());
                }
            } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                console.error(`Failed to open popup after ${maxAttempts} attempts.`);
            }
        };

        setTimeout(checkAndOpen, 50);
    }

    createPopupContent(items) {
        const safeItems = Array.isArray(items) ? items : [items];
        const isMultiple = safeItems.length > 1;
        let content = '';
        
        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                            <h4>${safeItems.length} Locations</h4>
                            <p>Showing clustered locations:</p>
                         </div>
                         <div class="cluster-popup-content">`;
        }
        
        safeItems.forEach(item => {
            if (!item || typeof item !== 'object' || typeof item.lat === 'undefined' || typeof item.lng === 'undefined') {
                console.warn("Skipping invalid or incomplete item in popup content:", item);
                return;
            }
        
            const level = item.congestion_level || 'Unknown';
            const company = item.company || 'Unknown';
            const location = item.location || 'Unknown Location';
            const congestionScore = (typeof item.congestion_score === 'number' && !isNaN(item.congestion_score)) ? item.congestion_score.toFixed(1) : 'N/A';
        
            content += `
                <div class="location-info">
                    <h5>${location}</h5>
                    <p><strong>Company:</strong> ${company}</p>
                    <p><strong>Congestion Level:</strong>
                        <span style="color: ${this.getColor(level, true)}">
                            ${level}
                        </span>
                    </p>
                    <p><strong>Dwell Time:</strong> ${congestionScore} hours</p>
                </div>
                ${isMultiple && safeItems.indexOf(item) !== safeItems.length - 1 ? '<hr>' : ''}
            `;
        });
        
        if (isMultiple) {
            content += '</div>';
        }
        
        return content || '<p>No valid data to display for this location.</p>';
    }

    addLastUpdatedText() {
        if (this.lastUpdatedControl) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        if (this.lastUpdated) {
            const date = new Date(this.lastUpdated);
            const formattedDate = date.toLocaleString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false 
            });

            const infoControl = L.control({ position: 'bottomleft' });

            infoControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'last-updated-info');
                div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
                return div;
            };

            infoControl.addTo(this.map);
            this.lastUpdatedControl = infoControl;
        }
    }

    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            const validYards = this.currentData
                .filter(item => item.Yard && item.Yard.trim() !== '')
                .map(item => item.Yard);

            const yards = [...new Set(validYards)].sort((a, b) => a.localeCompare(b));

            const filterDropdownHtml = `
                <select class="yard-filter">
                    <option value="" disabled selected hidden>Select Yard</option>
                    <option value="All">All Yards</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            const resetButtonHtml = `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            div.querySelector('.yard-filter').addEventListener('change', (e) => {
                const yardName = e.target.value;
                if (yardName === "All") {
                    console.log("Filter: All Yards selected. Resetting view.");
                    this.map.setView([37.8, -96], 4);
                    this.map.closePopup(); 
                    this.markerToOpenAfterMove = null; 
                } else if (yardName) {
                    console.log(`Filter selected: ${yardName}`);
                    const yardDataForFilter = this.currentData.filter(item => item.Yard === yardName);
                    if (yardDataForFilter.length > 0) {
                        const bounds = L.latLngBounds(yardDataForFilter.map(item => [item.lat, item.lng]));
                        
                        console.log(`Fitting map to bounds: ${bounds.toBBoxString()}`);
                        // 마커가 클러스터링되지 않고 개별적으로 보이도록 disableClusteringAtZoom + 1 보다 높은 줌 레벨로 맞춤
                        this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 }); 
                        
                        let foundMarkerForFilter = null;
                        // 모든 개별 마커를 확인하여 필터링된 야드에 해당하는 마커를 찾음
                        const allIndividualMarkers = this.allMarkers.getLayers(); 
                        for (const marker of allIndividualMarkers) {
                            if (marker.options.itemData && marker.options.itemData.Yard === yardName) {
                                foundMarkerForFilter = marker;
                                console.log(`Found marker object for filter: ${yardName}`);
                                break; 
                            }
                        }
                        // 찾은 마커를 맵 이동 후 팝업을 열기 위한 큐에 저장
                        this.markerToOpenAfterMove = foundMarkerForFilter;
                        if (!foundMarkerForFilter) {
                            console.warn(`No individual marker object found for yard '${yardName}' after filter selection. Pop-up may not open.`);
                        }
                    } else {
                        console.warn(`No data found for yard '${yardName}'.`);
                    }
                }
            });

            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                console.log("Reset button clicked.");
                this.map.setView([37.8, -96], 4);
                this.map.closePopup(); 
                this.markerToOpenAfterMove = null; 
                const yardFilter = div.querySelector('.yard-filter');
                if (yardFilter) {
                    yardFilter.value = ''; 
                    yardFilter.selectedIndex = 0; 
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };

        control.addTo(this.map);
    }

    addLegend() { 
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend');
            const levels = ['Very High', 'High', 'Low', 'Very Low', 'Average']; 
            const labels = [];

            for (let i = 0; i < levels.length; i++) {
                const level = levels[i];
                const color = this.getColor(level); 

                labels.push(
                    `<i style="background:${color}"></i> ${level}`
                );
            }

            div.innerHTML = '<h4>Congestion Level</h4>' + labels.join('<br>');
            return div;
        }.bind(this); 

        legend.addTo(this.map);
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
            'Average': '#bcbcbc',
            'Unknown': '#bcbcbc' 
        };

        const textColors = {
            'Very High': '#6b1414',
            'High': '#7c4616',
            'Low': '#30557b',
            'Very Low': '#002860',
            'Average': '#5e5e5e',
            'Unknown': '#5e5e5e'
        };

        return isText ? textColors[level] : circleColors[level];
    }

    displayErrorMessage(message) {
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

        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }
}

window.RailCongestionMap = RailCongestionMap;
