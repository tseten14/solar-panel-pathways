from solar_geometry import geometry_metrics, shape_filter_reason, utm_epsg_for


def test_utm_epsg_known_points():
    # Honolulu, HI (~zone 4N), Boston, MA (~zone 19N), Seattle, WA (~zone 10N)
    assert utm_epsg_for(-157.86, 21.31) == 32604
    assert utm_epsg_for(-71.06, 42.36) == 32619
    assert utm_epsg_for(-122.33, 47.61) == 32610


def _square_geojson(lng, lat, half_side_deg):
    return {
        "type": "Polygon",
        "coordinates": [[
            [lng - half_side_deg, lat - half_side_deg],
            [lng + half_side_deg, lat - half_side_deg],
            [lng + half_side_deg, lat + half_side_deg],
            [lng - half_side_deg, lat + half_side_deg],
            [lng - half_side_deg, lat - half_side_deg],
        ]],
    }


def test_square_is_compact_and_rectangular():
    geom = _square_geojson(-118.25, 34.05, 0.0002)
    m = geometry_metrics(geom)
    assert m["compactness"] > 0.7
    assert m["rectangularity"] > 0.9
    assert m["aspect_ratio"] < 1.3
    assert shape_filter_reason(m) is None


def _sliver_geojson(lng, lat, length_deg, width_deg):
    return {
        "type": "Polygon",
        "coordinates": [[
            [lng, lat],
            [lng + length_deg, lat],
            [lng + length_deg, lat + width_deg],
            [lng, lat + width_deg],
            [lng, lat],
        ]],
    }


def test_thin_sliver_is_filtered_as_elongated():
    geom = _sliver_geojson(-118.25, 34.05, 0.01, 0.00005)
    m = geometry_metrics(geom)
    assert shape_filter_reason(m) in ("too_elongated", "not_compact", "not_rectangular")


def test_tiny_square_is_filtered_as_too_small():
    geom = _square_geojson(-118.25, 34.05, 0.000002)
    m = geometry_metrics(geom)
    assert shape_filter_reason(m) == "too_small"
