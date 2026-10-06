# The timer's Live Activity: start, update and end it from the app, and
# report its push tokens. WRITTEN, NOT COMPILED (see ../index.ts).
Pod::Spec.new do |s|
  s.name           = 'FarmerLiveActivity'
  s.version        = '0.1.0'
  s.summary        = 'The timer Live Activity of the Farmer app.'
  s.description    = 'Starts, updates and ends the Live Activity of the timer, and reports its push tokens.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Profico'
  s.homepage       = 'https://github.com/profico/farmer'
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end
