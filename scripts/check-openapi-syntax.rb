#!/usr/bin/env ruby
# frozen_string_literal: true

require 'psych'

root = File.expand_path('..', __dir__)
files = Dir[File.join(root, 'packages', 'contracts', '*.yaml')].sort

abort 'No OpenAPI YAML contracts found.' if files.empty?

files.each do |path|
  begin
    Psych.parse_file(path)
  rescue Psych::SyntaxError => error
    warn "Invalid YAML: #{path}"
    warn error.message
    exit 1
  end
end

puts "OpenAPI YAML syntax valid: #{files.length} files"
